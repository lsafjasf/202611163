/* 撤销/重做：快照栈，仅记录已提交变更 */
(function (root, factory) {
  var api = factory(root.TF);
  if (typeof module === "object" && module.exports) module.exports = api;
  Object.assign(root.TF, api);
})(typeof self !== "undefined" ? self : this, function (TF) {
  "use strict";

  function History(limit) {
    this.stack = [];
    this.index = -1;
    this.limit = limit || 100;
  }

  History.prototype.push = function (project) {
    if (this.index < this.stack.length - 1) {
      this.stack = this.stack.slice(0, this.index + 1);
    }
    this.stack.push(TF.deepClone(project));
    if (this.stack.length > this.limit) this.stack.shift();
    this.index = this.stack.length - 1;
  };

  History.prototype.canUndo = function () { return this.index > 0; };
  History.prototype.canRedo = function () { return this.index < this.stack.length - 1; };

  History.prototype.undo = function () {
    if (!this.canUndo()) return null;
    this.index--;
    return TF.deepClone(this.stack[this.index]);
  };

  History.prototype.redo = function () {
    if (!this.canRedo()) return null;
    this.index++;
    return TF.deepClone(this.stack[this.index]);
  };

  History.prototype.reset = function (project) {
    this.stack = [TF.deepClone(project)];
    this.index = 0;
  };

  return { History: History };
});
