# Aqara Local (Camera) — Home Assistant Custom Integration

Local-first Home Assistant integration for Aqara cameras (built and verified
against the **Aqara G410** doorbell). Exposes the camera's on-device RTSP
streams as Home Assistant camera entities — **no cloud, no HomeKit**.

> Scope note: the **U200 Lite lock** is handled by Home Assistant's built-in
> **Matter** integration and is intentionally *not* duplicated here. This
> integration covers the part HA doesn't handle well out of the box: the
> Aqara camera's local RTSP feed, with discovery and a proper config flow.

## Features

- 🔍 **Zeroconf auto-discovery** via `_aqara._tcp` (pre-fills the host)
- 🎥 Two camera entities per device: **Main** and **Sub** stream
- 🔐 Credentials/paths entered in the UI (URL-encoded automatically)
- 🖼️ Snapshots via ffmpeg; live view via HA `stream` / go2rtc (WebRTC/HLS)
- 🏠 100% local — works with Frigate, automations, and dashboards

## Verified defaults (Aqara G410)

| Setting | Value |
|---|---|
| Port | `8554` (LIVE555, Digest auth) |
| Main stream | `/ch1` — 1600×1200, H.264 + AAC |
| Substream | `/ch2` — 1280×960, H.264 + AAC |

Enable RTSP in the **Aqara app → Camera settings → RTSP** to obtain the
username/password.

## Installation (HACS)

1. HACS → ⋮ → **Custom repositories**.
2. Add this repo URL, category **Integration**.
3. Install **Aqara Local (Camera)**, then restart Home Assistant.
4. **Settings → Devices & Services → Add Integration → Aqara Local**
   (or accept the auto-discovered device).
5. Enter host, port, RTSP username/password. Defaults suit the G410.

## Use with Frigate

Point Frigate at the substream for detection and the main stream for
recording (see `frigate-aqara.yaml` in the parent project for a full config):

```yaml
inputs:
  - path: rtsp://USER:PASS@HOST:8554/ch1   # record
    roles: [record]
  - path: rtsp://USER:PASS@HOST:8554/ch2   # detect
    roles: [detect]
```

## Limitations / honesty

- This exposes **video/audio/snapshots** only. The **physical doorbell button
  press** is *not* available unless your device exposes it over Matter; use
  Frigate person-detection as a local doorbell trigger otherwise.
- Credentials are stored by Home Assistant and embedded in stream URLs —
  appropriate for a trusted LAN.
- Tested on the G410; other Aqara cameras may use different ports/paths —
  override them in the config flow.

## License

MIT
