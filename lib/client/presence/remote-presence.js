var ot = require('../../ot');

module.exports = RemotePresence;
function RemotePresence(connection, presenceId, collection, id) {
  this.connection = connection;
  this.id = id;
  this.collection = collection;

  this.presenceId = presenceId;
  this.value = null;
  this.src = null;
  this.seq = null;

  this._doc = this.connection.get(collection, id);
  this._callbacksBySeq = {};
  this._pending = null;
  this._opCache = null;

  this._opHandler = this._handleOp.bind(this);
  this._createDelHandler = this._handleCreateDel.bind(this);
  this._loadHandler = this._handleLoad.bind(this);
  this._registerWithDoc();
}

RemotePresence.prototype._receiveUpdate = function(error, presence) {
  if (error) return this._doc.emit('error', error);
  if (this._pending && presence.seq < this._pending.seq) return;
  if (presence.src) this.src = presence.src;
  this._pending = presence;
  this._setPendingPresence();
};

RemotePresence.prototype._setPendingPresence = function() {
  if (!this._pending) return;
  if (this._pending.seq < this.seq) return this._pending = null;

  if (this._pending.v > this._doc.version) {
    return this._doc.fetch();
  }

  if (!this._catchUpStalePresence()) return;

  this.value = this._pending.p;
  this.seq = this._pending.seq;
  this._pending = null;
  this._setPresenceOnDoc();
};

RemotePresence.prototype._setPresenceOnDoc = function() {
  if (this.value == null) {
    var hadPresence = this._doc.remotePresences[this.presenceId] != null;
    delete this._doc.remotePresences[this.presenceId];
    if (!hadPresence) return;
  } else {
    this._doc.remotePresences[this.presenceId] = this.value;
  }

  this._doc.emit('presence', this.presenceId, this.value);
};

RemotePresence.prototype._registerWithDoc = function() {
  this._doc.on('op', this._opHandler);
  this._doc.on('create', this._createDelHandler);
  this._doc.on('del', this._createDelHandler);
  this._doc.on('load', this._loadHandler);
};

RemotePresence.prototype._handleOp = function(op, source, connectionId) {
  var isOwnOp = connectionId === this.src;
  this._transformAgainstOp(op, isOwnOp);
  this._cacheOp(op, isOwnOp);
  this._setPendingPresence();
};

RemotePresence.prototype._handleCreateDel = function() {
  this._cacheOp(null);
  this._setPendingPresence();
};

RemotePresence.prototype._handleLoad = function() {
  this.value = null;
  this._callbacksBySeq = {};
  this._pending = null;
  this._opCache = null;
  this._setPresenceOnDoc();
};

RemotePresence.prototype._cachePresenceReset = function() {
  this._cacheOp(null);
};

RemotePresence.prototype._transformAgainstOp = function(op, isOwnOp) {
  if (!this.value) return;

  try {
    this.value = this._doc.type.transformPresence(this.value, op, isOwnOp);
  } catch (error) {
    this._doc.emit('error', error);
  }
  this._setPresenceOnDoc();
};

RemotePresence.prototype._catchUpStalePresence = function() {
  if (this._pending.v >= this._doc.version) return true;

  if (!this._opCache) {
    this._startCachingOps();
    this._doc.fetch();
    this.connection._subscribeToPresence(this.collection, this.id, function(error) {
      if (error) this._doc.emit('error', error);
    }.bind(this));
    return false;
  }

  while (this._opCache[this._pending.v]) {
    var item = this._opCache[this._pending.v];
    var op = item.op;
    var isOwnOp = item.isOwnOp;
    // We use a null op to signify a create or a delete operation. In both
    // cases we just want to reset the presence (which doesn't make sense
    // in a new document), so just set the presence to null.
    if (op === null) {
      this._pending.p = null;
      this._pending.v++;
    } else {
      ot.transformPresence(this._pending, op, isOwnOp);
    }
  }

  var hasCaughtUp = this._pending.v >= this._doc.version;
  if (hasCaughtUp) {
    this._stopCachingOps();
  }

  return hasCaughtUp;
};

RemotePresence.prototype._startCachingOps = function() {
  this._opCache = [];
};

RemotePresence.prototype._stopCachingOps = function() {
  this._opCache = null;
};

RemotePresence.prototype._cacheOp = function(op, isOwnOp) {
  if (this._opCache) {
    op = op ? {op: op} : null;
    // Subtract 1 from the current doc version, because an op with v3
    // should be read as the op that takes a doc from v3 -> v4
    this._opCache[this._doc.version - 1] = {op: op, isOwnOp: isOwnOp};
  }
};
