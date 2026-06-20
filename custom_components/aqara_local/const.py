"""Constants for the Aqara Local integration."""

from __future__ import annotations

DOMAIN = "aqara_local"

# Config keys
CONF_HOST = "host"
CONF_PORT = "port"
CONF_USERNAME = "username"
CONF_PASSWORD = "password"
CONF_MAIN_PATH = "main_path"
CONF_SUB_PATH = "sub_path"
CONF_NAME = "name"

# Verified defaults for the Aqara G410 LIVE555 RTSP server.
# (Port 8554, Digest auth, /ch1 = main 1600x1200, /ch2 = sub 1280x960.)
DEFAULT_PORT = 8554
DEFAULT_MAIN_PATH = "/ch1"
DEFAULT_SUB_PATH = "/ch2"
DEFAULT_NAME = "Aqara Doorbell"

# Zeroconf service Aqara devices advertise on the LAN.
ZEROCONF_TYPE = "_aqara._tcp.local."

MANUFACTURER = "Aqara"
MODEL = "G410"
