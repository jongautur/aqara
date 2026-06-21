/**
 * Aqara Doorbell Card
 * A self-contained Lovelace card: live camera + U200 lock control.
 * One door-state toggle per lock (green/closed = locked, red/open = unlocked),
 * an optional second lock for two-door setups, battery, auto-relock and a
 * person-at-door badge.
 *
 * Dependency-free (no build step). Uses HA's card helpers for the live
 * camera so it inherits HLS/WebRTC/go2rtc behaviour automatically.
 */

const CARD_VERSION = "0.3.0";

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
        .btns button ha-icon { --mdc-icon-size: 26px; }
        /* Colour reflects the CURRENT door state. */
        .btns .is-locked { background: var(--success-color, #43a047); color: #fff; }
        .btns .is-unlocked { background: var(--error-color, #db4437); color: #fff; }
        .title { padding: 12px 14px 0; font-size: 18px; font-weight: 600; }
      </style>
      <div class="wrap">
        <div class="badge" id="badge"><ha-icon icon="mdi:account-alert"></ha-icon><span>At the door</span></div>
        <div class="title" id="title"></div>
        <div class="cam-slot" id="camSlot"></div>
        <div class="status">
          <span id="batteryWrap">Battery: <span class="state" id="battery">—</span></span>
          <span id="relockWrap">Auto-relock: <span class="state" id="relock">—</span></span>
        </div>
        <div class="btns" id="btns"></div>
      </div>
    `;
    this.appendChild(card);
    this._root = card;

    this._els = {
      title: card.querySelector("#title"),
      badge: card.querySelector("#badge"),
      camSlot: card.querySelector("#camSlot"),
      battery: card.querySelector("#battery"),
      batteryWrap: card.querySelector("#batteryWrap"),
      relock: card.querySelector("#relock"),
      relockWrap: card.querySelector("#relockWrap"),
      btns: card.querySelector("#btns"),
    };

    // One toggle button per configured lock (primary + optional second).
    const locks = [this._config.lock];
    if (this._config.lock2) locks.push(this._config.lock2);
    this._btns = locks.map((entity) => {
      const btn = document.createElement("button");
      btn.innerHTML = `<ha-icon></ha-icon><span></span>`;
      btn.addEventListener("click", () => this._toggle(entity));
      this._els.btns.appendChild(btn);
      return {
        entity,
        el: btn,
        icon: btn.querySelector("ha-icon"),
        label: btn.querySelector("span"),
      };
    });

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

  _isLocked(entity) {
    const obj = this._hass && this._hass.states[entity];
    return !!obj && obj.state === "locked";
  }

  _toggle(entity) {
    const locked = this._isLocked(entity);
    if (locked && !window.confirm("Unlock the door?")) return;
    this._hass.callService("lock", locked ? "unlock" : "lock", {
      entity_id: entity,
    });
  }

  _update() {
    if (!this._root || !this._hass) return;
    const c = this._config;

    this._els.title.textContent = c.name || "";
    this._els.title.style.display = c.name ? "block" : "none";

    if (this._cameraEl) this._cameraEl.hass = this._hass;

    // Each toggle shows the door's CURRENT state: green/closed when locked,
    // red/open when unlocked. Tap flips it.
    const multi = this._btns.length > 1;
    for (const { entity, el, icon, label } of this._btns) {
      const obj = this._hass.states[entity];
      const state = obj ? obj.state : "unavailable";
      const locked = state === "locked";
      const busy = state === "locking" || state === "unlocking";
      const unavailable = !obj || state === "unavailable";
      el.classList.toggle("is-locked", locked);
      el.classList.toggle("is-unlocked", !locked && !unavailable);
      icon.setAttribute("icon", locked ? "mdi:door-closed" : "mdi:door-open");
      // With two doors, label each by name; with one, show the state word.
      label.textContent = multi
        ? (obj && obj.attributes.friendly_name) || "Lock"
        : this._pretty(state);
      el.disabled = busy || unavailable;
    }

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
        name: "lock2",
        label: "Second lock (optional)",
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
  description: "Live camera + U200 door toggle(s) (green=locked, red=unlocked).",
  preview: true,
  documentationURL: "https://github.com/jongautur/aqara",
});

// eslint-disable-next-line no-console
console.info(
  `%c AQARA-DOORBELL-CARD %c v${CARD_VERSION} `,
  "color:#fff;background:#0a8;font-weight:700",
  "color:#0a8;background:#222"
);
