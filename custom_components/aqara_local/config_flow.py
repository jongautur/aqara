"""Config flow for the Aqara Local integration."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import logging
import os
import re
from typing import Any
from urllib.parse import quote

import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult
from homeassistant.helpers.service_info.zeroconf import ZeroconfServiceInfo

from .const import (
    CONF_HOST,
    CONF_MAIN_PATH,
    CONF_NAME,
    CONF_PASSWORD,
    CONF_PORT,
    CONF_SUB_PATH,
    CONF_USERNAME,
    DEFAULT_MAIN_PATH,
    DEFAULT_NAME,
    DEFAULT_PORT,
    DEFAULT_SUB_PATH,
    DOMAIN,
)

_LOGGER = logging.getLogger(__name__)


def build_rtsp_url(data: dict[str, Any], path: str) -> str:
    """Compose an RTSP URL with URL-encoded credentials."""
    user = quote(str(data[CONF_USERNAME]), safe="")
    pwd = quote(str(data[CONF_PASSWORD]), safe="")
    host = data[CONF_HOST]
    port = data[CONF_PORT]
    if not path.startswith("/"):
        path = "/" + path
    return f"rtsp://{user}:{pwd}@{host}:{port}{path}"


async def _async_check_rtsp(host: str, port: int) -> bool:
    """Lightweight reachability check: can we open the RTSP TCP port?"""
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port), timeout=5
        )
        writer.close()
        await writer.wait_closed()
        return True
    except (OSError, asyncio.TimeoutError) as err:
        _LOGGER.debug("RTSP port check failed for %s:%s: %s", host, port, err)
        return False


def _rtsp_status(text: str) -> int | None:
    """Parse the status code from an RTSP response line."""
    match = re.match(r"RTSP/1\.0 (\d{3})", text)
    return int(match.group(1)) if match else None


def _build_authorization(
    challenge: str, user: str, pwd: str, uri: str
) -> str | None:
    """Build an Authorization header from a WWW-Authenticate challenge."""
    match = re.search(
        r"WWW-Authenticate:\s*(\w+)\s+(.*)", challenge, re.IGNORECASE
    )
    if not match:
        return None
    scheme = match.group(1).lower()

    if scheme == "basic":
        token = base64.b64encode(f"{user}:{pwd}".encode()).decode()
        return f"Basic {token}"

    if scheme != "digest":
        return None

    params = dict(re.findall(r'(\w+)="([^"]*)"', match.group(2)))
    realm = params.get("realm", "")
    nonce = params.get("nonce", "")
    qop = params.get("qop")
    ha1 = hashlib.md5(f"{user}:{realm}:{pwd}".encode()).hexdigest()
    ha2 = hashlib.md5(f"DESCRIBE:{uri}".encode()).hexdigest()

    if qop:
        cnonce = hashlib.md5(os.urandom(8)).hexdigest()[:16]
        nc = "00000001"
        response = hashlib.md5(
            f"{ha1}:{nonce}:{nc}:{cnonce}:auth:{ha2}".encode()
        ).hexdigest()
        return (
            f'Digest username="{user}", realm="{realm}", nonce="{nonce}", '
            f'uri="{uri}", qop=auth, nc={nc}, cnonce="{cnonce}", '
            f'response="{response}"'
        )

    response = hashlib.md5(f"{ha1}:{nonce}:{ha2}".encode()).hexdigest()
    return (
        f'Digest username="{user}", realm="{realm}", nonce="{nonce}", '
        f'uri="{uri}", response="{response}"'
    )


async def _async_probe_rtsp(
    host: str, port: int, user: str, pwd: str, path: str
) -> str:
    """DESCRIBE the stream to verify reachability, credentials and path.

    Returns one of: "ok", "cannot_connect", "invalid_auth", "invalid_path".
    """
    if not path.startswith("/"):
        path = "/" + path
    uri = f"rtsp://{host}:{port}{path}"

    def describe(cseq: int, auth: str | None) -> bytes:
        lines = [
            f"DESCRIBE {uri} RTSP/1.0",
            f"CSeq: {cseq}",
            "Accept: application/sdp",
            "User-Agent: HomeAssistant-AqaraLocal",
        ]
        if auth:
            lines.append(f"Authorization: {auth}")
        return ("\r\n".join(lines) + "\r\n\r\n").encode()

    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port), timeout=5
        )
    except (OSError, asyncio.TimeoutError) as err:
        _LOGGER.debug("RTSP connect failed for %s:%s: %s", host, port, err)
        return "cannot_connect"

    try:
        writer.write(describe(1, None))
        await writer.drain()
        text = (await asyncio.wait_for(reader.read(2048), timeout=5)).decode(
            "utf-8", "replace"
        )
        status = _rtsp_status(text)

        if status == 401:
            auth = _build_authorization(text, user, pwd, uri)
            if auth is None:
                return "invalid_auth"
            writer.write(describe(2, auth))
            await writer.drain()
            text = (
                await asyncio.wait_for(reader.read(2048), timeout=5)
            ).decode("utf-8", "replace")
            status = _rtsp_status(text)

        if status == 200:
            return "ok"
        if status in (401, 403):
            return "invalid_auth"
        if status in (404, 451):
            return "invalid_path"
        _LOGGER.debug("RTSP DESCRIBE %s returned status %s", uri, status)
        return "cannot_connect"
    except (OSError, asyncio.TimeoutError) as err:
        _LOGGER.debug("RTSP DESCRIBE failed for %s: %s", uri, err)
        return "cannot_connect"
    finally:
        writer.close()
        try:
            await writer.wait_closed()
        except (OSError, asyncio.TimeoutError):
            pass


class AqaraLocalConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Aqara Local."""

    VERSION = 1

    def __init__(self) -> None:
        self._discovered_host: str | None = None

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Handle the manual setup step."""
        errors: dict[str, str] = {}

        if user_input is not None:
            result = await _async_probe_rtsp(
                user_input[CONF_HOST],
                user_input[CONF_PORT],
                user_input[CONF_USERNAME],
                user_input[CONF_PASSWORD],
                user_input[CONF_MAIN_PATH],
            )
            if result == "ok":
                # Main stream verified; warn (don't block) if the substream
                # path is wrong, since it's optional for live viewing.
                sub_result = await _async_probe_rtsp(
                    user_input[CONF_HOST],
                    user_input[CONF_PORT],
                    user_input[CONF_USERNAME],
                    user_input[CONF_PASSWORD],
                    user_input[CONF_SUB_PATH],
                )
                if sub_result != "ok":
                    _LOGGER.warning(
                        "Aqara substream path %s failed (%s); continuing",
                        user_input[CONF_SUB_PATH],
                        sub_result,
                    )
                await self.async_set_unique_id(
                    f"{user_input[CONF_HOST]}:{user_input[CONF_PORT]}"
                )
                self._abort_if_unique_id_configured()
                return self.async_create_entry(
                    title=user_input.get(CONF_NAME, DEFAULT_NAME),
                    data=user_input,
                )
            errors["base"] = result

        host_default = self._discovered_host or ""
        schema = vol.Schema(
            {
                vol.Required(CONF_NAME, default=DEFAULT_NAME): str,
                vol.Required(CONF_HOST, default=host_default): str,
                vol.Required(CONF_PORT, default=DEFAULT_PORT): int,
                vol.Required(CONF_USERNAME): str,
                vol.Required(CONF_PASSWORD): str,
                vol.Required(CONF_MAIN_PATH, default=DEFAULT_MAIN_PATH): str,
                vol.Required(CONF_SUB_PATH, default=DEFAULT_SUB_PATH): str,
            }
        )
        return self.async_show_form(
            step_id="user", data_schema=schema, errors=errors
        )

    async def async_step_zeroconf(
        self, discovery_info: ZeroconfServiceInfo
    ) -> ConfigFlowResult:
        """Handle discovery via _aqara._tcp; pre-fill the host.

        Many Aqara devices advertise _aqara._tcp, including hubs like the
        M100 that have no camera. Only continue for devices that actually
        expose the RTSP port, so hubs are silently ignored.
        """
        host = discovery_info.host

        if not await _async_check_rtsp(host, DEFAULT_PORT):
            return self.async_abort(reason="not_a_camera")

        await self.async_set_unique_id(host, raise_on_progress=False)
        self._abort_if_unique_id_configured(updates={CONF_HOST: host})

        # Use the advertised model name for a nicer title, when present.
        model = discovery_info.properties.get("model") or "Aqara"
        self._discovered_host = host
        self.context["title_placeholders"] = {"name": f"{model} @ {host}"}
        return await self.async_step_user()
