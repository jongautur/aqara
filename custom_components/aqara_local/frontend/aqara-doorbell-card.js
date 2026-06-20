/**
 * Aqara Doorbell Card
 * A self-contained Lovelace card: live camera + U200 lock control
 * (Open / Unlock / Lock), battery, auto-relock and a person-at-door badge.
 *
 * Dependency-free (no build step). Uses HA's card helpers for the live
 * camera so it inherits HLS/WebRTC/go2rtc behaviour automatically.
 */

const CARD_VERSION = "0.2.0";

class AqaraDoorbellCard extends HTMLElement {
  static getStubConfig() {
    return { camera: "", lock: "", name: "Front Door" };
  }

  static getConfigElement() {
    return document.createElement("aqara-doorbell-card-editor");
  }

  setConfig(config) {
    if (!config || !config.camera) {
      throw new Error("You must define a 'camera' entity");
    }
    if (!config.lock) {
      throw new Error("You must define a 'lock' entity");
    }
    this._config = config;
    this._built = false;
    if (this._root) {
      // rebuild on config change (e.g. live editor)
      this._root = null;
      this.innerHTML = "";
      this._cameraEl = null;
    }
  }

  set hass(hass) {
    this._hass = hass;
    this._build();
    this._update();
  }

  getCardSize() {
    return 5;
  }

  _build() {
    if (this._built || !this._hass) return;
    this._built = true;

    const card = document.createElement("ha-card");
    card.innerHTML = `
      <style>
        .wrap { position: relative; }
        .badge {
          position: absolute; top: 8px; left: 8px; z-index: 2;
          background: var(--error-color, #db4437); color: #fff;
          padding: 4px 10px; border-radius: 14px; font-size: 13px;
          font-weight: 600; display: none; align-items: center; gap: 6px;
          box-shadow: 0 1px 4px rgba(0,0,0,.4);
        }
        .badge.on { display: inline-flex; }
        .cam-slot { width: 100%; }
        .cam-slot ha-card, .cam-slot .type-picture-entity { box-shadow: none; }
        .status {
          display: flex; justify-content: space-between; flex-wrap: wrap;
          gap: 8px; padding: 10px 14px 2px; font-size: 14px;
          color: var(--secondary-text-color);
        }
        .status .state { color: var(--primary-text-color); font-weight: 600; }
        .btns { display: flex; gap: 8px; padding: 12px 14px 14px; }
        .btns button {
          flex: 1; border: none; border-radius: 10px; padding: 12px 4px;
          font-size: 14px; font-weight: 600; cursor: pointer;
          display: flex; flex-direction: column; align-items: center; gap: 4px;
          background: var(--secondary-background-color);
          color: var(--primary-text-color); transition: filter .15s;
        }
        .btns button:hover { filter: brightness(1.08); }
        .btns button:disabled { opacity: .45; cursor: default; }
        .btns button ha-icon { --mdc-icon-size: 24px; }
        .btns .open { background: var(--success-color, #43a047); color: #fff; }
        .btns .lock { background: var(--primary-color); color: #fff; }
        .title { padding: 12px 14px 0; font-size: 18px; font-weight: 600; }
      </style>
      <div class="wrap">
        <div class="badge" id="badge"><ha-icon icon="mdi:account-alert"></ha-icon><span>At the door</span></div>
        <div class="title" id="title"></div>
        <div class="cam-slot" id="camSlot"></div>
        <div class="status">
          <span>Lock: <span class="state" id="lockState">—</span></span>
          <span id="batteryWrap">Battery: <span class="state" id="battery">—</span></span>
          <span id="relockWrap">Auto-relock: <span class="state" id="relock">—</span></span>
        </div>
        <div class="btns">
          <button class="open" id="btnOpen">
            <ha-icon icon="mdi:door-open"></ha-icon><span>Open</span>
          </button>
          <button id="btnUnlock">
            <ha-icon icon="mdi:lock-open-variant"></ha-icon><span>Unlock</span>
          </button>
          <button class="lock" id="btnLock">
            <ha-icon icon="mdi:lock"></ha-icon><span>Lock</span>
          </button>
        </div>
      </div>
    `;
    this.appendChild(card);
    this._root = card;

    this._els = {
      title: card.querySelector("#title"),
      badge: card.querySelector("#badge"),
      camSlot: card.querySelector("#camSlot"),
      lockState: card.querySelector("#lockState"),
      battery: card.querySelector("#battery"),
      batteryWrap: card.querySelector("#batteryWrap"),
      relock: card.querySelector("#relock"),
      relockWrap: card.querySelector("#relockWrap"),
      btnOpen: card.querySelector("#btnOpen"),
      btnUnlock: card.querySelector("#btnUnlock"),
      btnLock: card.querySelector("#btnLock"),
    };

    this._els.btnOpen.addEventListener("click", () =>
      this._service("open", "Open (unlatch) the door?")
    );
    this._els.btnUnlock.addEventListener("click", () =>
      this._service("unlock", "Unlock the door?")
    );
    this._els.btnLock.addEventListener("click", () =>
      this._service("lock", null)
    );

    this._ensureCamera();
  }

  async _ensureCamera() {
    if (this._cameraEl || !this._hass) return;
    const helpers = await window.loadCardHelpers();
    this._cameraEl = helpers.createCardElement({
      type: "picture-entity",
      entity: this._config.camera,
      camera_view: "live",
      show_state: false,
      show_name: false,
    });
    this._cameraEl.hass = this._hass;
    this._els.camSlot.appendChild(this._cameraEl);
  }

  _service(action, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return;
    this._hass.callService("lock", action, {
      entity_id: this._config.lock,
    });
  }

  _update() {
    if (!this._root || !this._hass) return;
    const c = this._config;

    this._els.title.textContent = c.name || "";
    this._els.title.style.display = c.name ? "block" : "none";

    if (this._cameraEl) this._cameraEl.hass = this._hass;

    const lockObj = this._hass.states[c.lock];
    const lockState = lockObj ? lockObj.state : "unavailable";
    this._els.lockState.textContent = this._pretty(lockState);

    // Disable Open if the lock doesn't advertise the OPEN feature (bit 0).
    const sf = lockObj && lockObj.attributes.supported_features;
    const supportsOpen = (sf & 1) === 1;
    this._els.btnOpen.disabled = !supportsOpen;
    this._els.btnOpen.title = supportsOpen
      ? ""
      : "This lock does not support unlatch/open";

    // Battery
    if (c.battery && this._hass.states[c.battery]) {
      const b = this._hass.states[c.battery];
      this._els.battery.textContent = `${b.state}${b.attributes.unit_of_measurement || "%"}`;
      this._els.batteryWrap.style.display = "";
    } else {
      this._els.batteryWrap.style.display = "none";
    }

    // Auto-relock
    if (c.auto_relock && this._hass.states[c.auto_relock]) {
      const r = this._hass.states[c.auto_relock];
      const v = parseInt(r.state, 10);
      this._els.relock.textContent = v > 0 ? `${v}s` : "off";
      this._els.relockWrap.style.display = "";
    } else {
      this._els.relockWrap.style.display = "none";
    }

    // Person-at-door badge
    const motion = c.motion && this._hass.states[c.motion];
    this._els.badge.classList.toggle("on", !!(motion && motion.state === "on"));
  }

  _pretty(s) {
    if (!s) return "—";
    return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
  }
}

class AqaraDoorbellCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
  }

  _render() {
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) => s.label || s.name;
      this._form.addEventListener("value-changed", (e) => {
        this._config = e.detail.value;
        this.dispatchEvent(
          new CustomEvent("config-changed", {
            detail: { config: this._config },
          })
        );
      });
      this.appendChild(this._form);
    }
    this._form.schema = [
      { name: "name", label: "Title", selector: { text: {} } },
      {
        name: "camera",
        label: "Camera",
        required: true,
        selector: { entity: { domain: "camera" } },
      },
      {
        name: "lock",
        label: "Lock",
        required: true,
        selector: { entity: { domain: "lock" } },
      },
      {
        name: "battery",
        label: "Battery sensor (optional)",
        selector: { entity: { domain: "sensor", device_class: "battery" } },
      },
      {
        name: "auto_relock",
        label: "Auto-relock number (optional)",
        selector: { entity: { domain: "number" } },
      },
      {
        name: "motion",
        label: "Motion/person sensor (optional)",
        selector: { entity: { domain: "binary_sensor" } },
      },
    ];
    this._form.data = this._config;
    if (this._hass) this._form.hass = this._hass;
  }
}

customElements.define("aqara-doorbell-card", AqaraDoorbellCard);
customElements.define("aqara-doorbell-card-editor", AqaraDoorbellCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "aqara-doorbell-card",
  name: "Aqara Doorbell Card",
  description: "Live camera + U200 lock control (Open/Unlock/Lock).",
  preview: true,
  documentationURL: "https://github.com/jongautur/aqara",
});

// eslint-disable-next-line no-console
console.info(
  `%c AQARA-DOORBELL-CARD %c v${CARD_VERSION} `,
  "color:#fff;background:#0a8;font-weight:700",
  "color:#0a8;background:#222"
);
