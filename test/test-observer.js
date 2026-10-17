const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const script = fs.readFileSync(path.join(__dirname, "../src/template/kimi-renamer.js"), "utf8")
  .replace("__CONFIG_PLACEHOLDER__", "{}")
  .replace("function mountHeaderButton() {", "function mountHeaderButton() { globalThis.mounts++; globalThis.onMount(); return;");

function setup(readyState) {
  const timers = new Map();
  const documentListeners = new Map();
  const windowListeners = new Map();
  let nextTimer = 0;
  let observer;
  const body = {};
  const context = {
    mounts: 0,
    onMount() { observer.emit(); },
    document: {
      readyState,
      body: readyState === "loading" ? null : body,
      addEventListener(event, callback, options) { documentListeners.set(event, { callback, options }); },
    },
    window: { addEventListener(event, callback) { windowListeners.set(event, callback); } },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.active = false; observer = this; }
      disconnect() { this.active = false; }
      observe(target, options) {
        assert.strictEqual(target, body, "只应在 body 就绪后监听 body");
        assert.ok(options.childList && options.subtree);
        this.active = true;
      }
      emit() { if (this.active) this.callback([]); }
    },
    setTimeout(callback, delay) {
      assert.strictEqual(delay, 100);
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    },
    console: { log() {} },
  };
  vm.runInNewContext(script, context);
  return {
    context, timers, observer, documentListeners, windowListeners,
    ready() {
      context.document.body = body;
      documentListeners.get("DOMContentLoaded").callback();
    },
    flush() {
      assert.strictEqual(timers.size, 1, "密集变更只能安排一个后续任务");
      const [id, callback] = timers.entries().next().value;
      timers.delete(id);
      callback();
    },
  };
}

for (const readyState of ["loading", "complete"]) {
  const test = setup(readyState);
  if (readyState === "loading") {
    assert.strictEqual(test.context.mounts, 0);
    assert.strictEqual(test.observer.active, false);
    assert.strictEqual(test.documentListeners.get("DOMContentLoaded").options.once, true);
    test.ready();
  }
  assert.strictEqual(test.context.mounts, 1);
  assert.strictEqual(test.observer.active, true);
  assert.strictEqual(test.timers.size, 0, "首次挂载不能监听到自身修改");

  for (let i = 0; i < 100; i++) test.observer.emit();
  test.windowListeners.get("popstate")();
  assert.strictEqual(test.context.mounts, 1, "observer 回调不能同步扫描或修改 DOM");
  test.flush();
  assert.strictEqual(test.context.mounts, 2);
  assert.strictEqual(test.timers.size, 0, "补丁自身修改不能引起挂载循环");

  test.observer.emit();
  test.flush();
  assert.strictEqual(test.context.mounts, 3, "挂载后仍需响应宿主重新渲染");

  test.context.onMount = () => { throw new Error("模拟挂载失败"); };
  test.observer.emit();
  assert.throws(() => test.flush(), /模拟挂载失败/);
  assert.strictEqual(test.observer.active, true, "失败后也必须恢复监听");
  test.context.onMount = () => {};
  test.observer.emit();
  test.flush();
}

console.log("✅ DOM 监听合并调度、自身变更隔离、延迟初始化及异常恢复回归测试通过");
