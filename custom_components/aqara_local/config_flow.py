"""Config flow for the Aqara Local integration."""

from __future__ import annotations

import asyncio
import logging
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
            if not await _async_check_rtsp(
                user_input[CONF_HOST], user_input[CONF_PORT]
            ):
                errors["base"] = "cannot_connect"
            else:
                await self.async_set_unique_id(
                    f"{user_input[CONF_HOST]}:{user_input[CONF_PORT]}"
                )
                self._abort_if_unique_id_configured()
                return self.async_create_entry(
                    title=user_input.get(CONF_NAME, DEFAULT_NAME),
                    data=user_input,
                )

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
        """Handle discovery via _aqara._tcp; pre-fill the host."""
        host = discovery_info.host
        await self.async_set_unique_id(host, raise_on_progress=False)
        self._abort_if_unique_id_configured(updates={CONF_HOST: host})
        self._discovered_host = host
        self.context["title_placeholders"] = {"name": f"Aqara @ {host}"}
        return await self.async_step_user()
