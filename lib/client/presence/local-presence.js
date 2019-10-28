var emitter = require('../../emitter');

module.exports = LocalPresence;
function LocalPresence(connection, presenceId, collection, id) {
  emitter.EventEmitter.call(this);

  if (!presenceId || typeof presenceId !== 'string') {
    throw new Error('Presence ID must be a string');
  }

  this.connection = connection;
  this.id = id;
  this.collection = collection;

  this.presenceId = presenceId;
  this.value = null;

  this._doc = this.connection.get(collection, id);
  this._callbacksBySeq = {};
  this._seq = null;
  this._pendingMessages = [];

  this._opHandler = this._transformAgainstOp.bind(this);
  this._createOrDelHandler = this._handleCreateOrDel.bind(this);
  this._loadHandler = this._handleLoad.bind(this);
  this._registerWithDoc();
}
emitter.mixin(LocalPresence);

LocalPresence.prototype.update = function(value, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = null;
  }

  if (!this._doc.type) {
    var error = {code: 9999, message: 'Cannot submit presence. Document has not been created'};
    if (callback) return process.nextTick(callback, error);
    return this.emit('error', error);
  };

  this.value = value;
  this.send(options, callback);
};

LocalPresence.prototype.clear = function(callback) {
  this.update(null, callback);
};

LocalPresence.prototype.send = function(options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = null;
  }

  var message = this._message(options);
  this._pendingMessages.push(message);
  this._callbacksBySeq[message.seq] = callback;

  this._sendPending();
};

// TODO: Handle Doc destroyed
LocalPresence.prototype.destroy = function(callback) {
  this.update(null, function(error) {
    if (error) {
      if (callback) return callback(error);
      this.emit('error', error);
    }

    this._doc.removeListener('op', this._opHandler);
    this._doc.removeListener('create', this._createOrDelHandler);
    this._doc.removeListener('del', this._createOrDelHandler);
    this._doc.removeListener('load', this._loadHandler);

    this.connection._destroyLocalPresence(this.collection, this.id, this.presenceId);

    callback();
  }.bind(this));
};

LocalPresence.prototype._sendPending = function() {
  this._doc.whenNothingPending(function() {
    if (!this.connection.canSend) {
      return;
    }

    this._pendingMessages.forEach(function(message) {
      message.t = this._doc.type.uri;
      message.v = this._doc.version;
      this.connection.send(message);
    }.bind(this));

    this._pendingMessages = [];
  }.bind(this));
};

LocalPresence.prototype._ack = function(error, seq) {
  this._doc.subscribedToPresence = true;
  var callback = this._callbacksBySeq[seq];
  if (callback) return callback(error);
  if (error) this.emit('error', error);
};

LocalPresence.prototype._registerWithDoc = function() {
  this._doc.on('op', this._opHandler);
  this._doc.on('create', this._createOrDelHandler);
  this._doc.on('del', this._createOrDelHandler);
  this._doc.on('load', this._loadHandler);
};

LocalPresence.prototype._message = function(options) {
  options = options || {};
  this._seq = this.connection.seq++;
  var shouldRequestPresence = !!options.requestPresence || !this._doc.subscribedToPresence;
  return {
    a: 'p',
    id: this.presenceId,
    c: this.collection,
    d: this.id,
    v: null,
    p: this.value,
    t: null,
    r: shouldRequestPresence,
    u: !!options.unsubscribe,
    seq: this._seq
  };
};

LocalPresence.prototype._transformAgainstOp = function(op, source) {
  this._pendingMessages.forEach(function(message) {
    message.p = this._doc.type.transformPresence(message.p, op, source);
  }.bind(this));

  try {
    this.value = this._doc.type.transformPresence(this.value, op, source);
  } catch (error) {
    this.emit('error', error);
  }
};

LocalPresence.prototype._handleCreateOrDel = function() {
  this._pendingMessages.forEach(function(message) {
    message.p = null;
  });

  this.value = null;
};

LocalPresence.prototype._handleLoad = function() {
  this.value = null;
  this._pendingMessages = [];
};

LocalPresence.prototype._onConnectionStateChanged = function() {
  if (this.connection.canSend && this._pendingMessages.length) {
    this._sendPending();
  }
};
