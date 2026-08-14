const KEY_BINDINGS = {
  KeyW: 'forward',
  KeyS: 'backward',
  KeyA: 'left',
  KeyD: 'right',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  ControlLeft: 'crouch',
  KeyC: 'crouch',
  Space: 'jump',
  KeyQ: 'leanLeft',
  KeyE: 'leanRight',
  KeyR: 'reload',
};

export class InputState {
  constructor(canvas) {
    this.canvas = canvas;
    this.actions = Object.create(null);
    this.virtual = Object.create(null);
    this.mouseX = 0;
    this.mouseY = 0;
    this.lookX = 0;
    this.lookY = 0;
    this.enabled = true;
    this.listeners = [];
    this.install();
  }

  install() {
    const listen = (target, type, fn, options) => {
      target.addEventListener(type, fn, options);
      this.listeners.push(() => target.removeEventListener(type, fn, options));
    };
    listen(window, 'keydown', (event) => {
      const action = KEY_BINDINGS[event.code];
      if (action) {
        this.actions[action] = true;
        event.preventDefault();
      }
    });
    listen(window, 'keyup', (event) => {
      const action = KEY_BINDINGS[event.code];
      if (action) this.actions[action] = false;
    });
    listen(window, 'blur', () => this.clear());
    listen(this.canvas, 'mousedown', (event) => {
      if (event.button === 0) this.actions.fire = true;
      if (event.button === 2) this.actions.ads = true;
      if (document.pointerLockElement !== this.canvas) this.canvas.requestPointerLock?.();
    });
    listen(window, 'mouseup', (event) => {
      if (event.button === 0) this.actions.fire = false;
      if (event.button === 2) this.actions.ads = false;
    });
    listen(window, 'mousemove', (event) => {
      if (document.pointerLockElement === this.canvas) {
        this.mouseX += event.movementX;
        this.mouseY += event.movementY;
      }
    });
    listen(this.canvas, 'contextmenu', (event) => event.preventDefault());
  }

  isDown(action) {
    return Boolean(this.enabled && (this.actions[action] || this.virtual[action]));
  }

  consumePressed(action) {
    const down = this.isDown(action);
    const key = `_${action}Latch`;
    const pressed = down && !this[key];
    this[key] = down;
    return pressed;
  }

  consumeLook() {
    this.lookX = this.mouseX;
    this.lookY = this.mouseY;
    this.mouseX = 0;
    this.mouseY = 0;
    return this;
  }

  injectLook(x, y) {
    this.mouseX += x;
    this.mouseY += y;
  }

  setVirtual(action, value) {
    this.virtual[action] = Boolean(value);
  }

  clearVirtual() {
    for (const key of Object.keys(this.virtual)) this.virtual[key] = false;
  }

  clear() {
    for (const key of Object.keys(this.actions)) this.actions[key] = false;
    this.clearVirtual();
    for (const key of Object.keys(this)) if (key.startsWith('_') && key.endsWith('Latch')) this[key] = false;
    this.mouseX = 0;
    this.mouseY = 0;
    this.lookX = 0;
    this.lookY = 0;
  }

  dispose() {
    for (const remove of this.listeners.splice(0)) remove();
  }
}
