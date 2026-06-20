"""Camera platform for the Aqara Local integration."""

from __future__ import annotations

from homeassistant.components.camera import Camera, CameraEntityFeature
from homeassistant.components.ffmpeg import async_get_image
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .config_flow import build_rtsp_url
from .const import (
    CONF_HOST,
    CONF_MAIN_PATH,
    CONF_NAME,
    CONF_SUB_PATH,
    DEFAULT_NAME,
    DOMAIN,
    MANUFACTURER,
    MODEL,
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the Aqara camera entities from a config entry."""
    data = hass.data[DOMAIN][entry.entry_id]
    name = data.get(CONF_NAME, DEFAULT_NAME)

    main_url = build_rtsp_url(data, data[CONF_MAIN_PATH])
    sub_url = build_rtsp_url(data, data[CONF_SUB_PATH])

    device_info = DeviceInfo(
        identifiers={(DOMAIN, entry.entry_id)},
        name=name,
        manufacturer=MANUFACTURER,
        model=MODEL,
        configuration_url=f"http://{data[CONF_HOST]}",
    )

    async_add_entities(
        [
            AqaraCamera(entry, device_info, f"{name} Main", main_url, "main"),
            AqaraCamera(entry, device_info, f"{name} Sub", sub_url, "sub"),
        ]
    )


class AqaraCamera(Camera):
    """An Aqara RTSP stream exposed as a Home Assistant camera."""

    _attr_supported_features = CameraEntityFeature.STREAM
    _attr_has_entity_name = False

    def __init__(
        self,
        entry: ConfigEntry,
        device_info: DeviceInfo,
        name: str,
        url: str,
        suffix: str,
    ) -> None:
        """Initialize the camera."""
        super().__init__()
        self._url = url
        self._attr_name = name
        self._attr_unique_id = f"{entry.entry_id}_{suffix}"
        self._attr_device_info = device_info

    async def stream_source(self) -> str:
        """Return the RTSP source for the live stream / go2rtc restream."""
        return self._url

    async def async_camera_image(
        self, width: int | None = None, height: int | None = None
    ) -> bytes | None:
        """Grab a still image via ffmpeg."""
        return await async_get_image(
            self.hass, self._url, width=width, height=height
        )
