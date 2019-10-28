var Backend = require('../../lib/backend');
var expect = require('chai').expect;
var async = require('async');
var types = require('../../lib/types');
var presenceTestType = require('./presence-test-type');
var errorHandler = require('../util').errorHandler;
types.register(presenceTestType.type);

describe.only('Presence', function() {
  var backend;
  var connection1;
  var connection2;
  var doc1;
  var doc2;
  var presence1;
  var presence2;
  var presencePauser;

  beforeEach(function(done) {
    backend = new Backend();
    connection1 = backend.connect();
    connection2 = backend.connect();

    presencePauser = new PresencePauser();

    backend.use(backend.MIDDLEWARE_ACTIONS.sendPresence, function(request, callback) {
      presencePauser.sendPresence(request, callback);
    });

    doc1 = connection1.get('books', 'northern-lights');
    doc2 = connection2.get('books', 'northern-lights');

    async.series([
      doc1.create.bind(doc1, 'North Lights', presenceTestType.type.name),
      doc1.subscribe.bind(doc1),
      doc2.subscribe.bind(doc2),
      function(next) {
        presence1 = connection1.getPresence('books', 'northern-lights', 'presence-1');
        presence2 = connection2.getPresence('books', 'northern-lights', 'presence-2');
        next();
      }
    ], done);
  });

  afterEach(function(done) {
    delete presenceTestType.type.invert;
    backend.close(done);
  });

  it('emits a presence event when creating presence from another connection', function(done) {
    async.series([
      doc1.subscribeToPresence.bind(doc1),
      function(next) {
        doc1.once('presence', function(id, presence) {
          expect(presence).to.eql({index: 1});
          expect(doc1.presences()).to.eql([
            {
              id: 'presence-2',
              data: {index: 1}
            }
          ]);
          next();
        });

        presence2.update({index: 1}, errorHandler(done));
      }
    ], done);
  });

  it('updates presence without a callback', function(done) {
    async.series([
      doc1.subscribeToPresence.bind(doc1),
      function(next) {
        presence2.update({index: 1});
        doc1.once('presence', function(id, presence) {
          expect(presence).to.eql({index: 1});
          next();
        });
      }
    ], done);
  });

  it('clears presence', function(done) {
    async.series([
      doc1.subscribeToPresence.bind(doc1),
      function(next) {
        presence2.update({index: 3}, errorHandler(done));
        doc1.once('presence', function(id, presence) {
          expect(presence).to.eql({index: 3});
          next();
        });
      },
      function(next) {
        presence2.clear(errorHandler(done));
        doc1.once('presence', function(id, presence) {
          expect(presence).to.be.null;
          next();
        });
      }
    ], done);
  });

  it('has multiple presences on a single connection', function(done) {
    var presence2a = connection2.getPresence('books', 'northern-lights', 'presence-2a');

    async.series([
      doc1.subscribeToPresence.bind(doc1),
      function(next) {
        doc1.on('presence', function() {
          if (doc1.presences().length !== 2) return;
          expect(doc1.presences()).to.eql([
            {id: 'presence-2', data: {index: 1}},
            {id: 'presence-2a', data: {index: 3}}
          ]);
          next();
        });

        presence2.update({index: 1}, errorHandler(done));
        presence2a.update({index: 3}, errorHandler(done));
      }
    ], done);
  });

  it('destroys presence', function(done) {
    async.series([
      doc1.subscribeToPresence.bind(doc1),
      function(next) {
        presence2.update({index: 1}, errorHandler(done));
        doc1.once('presence', function() {
          next();
        });
      },
      function(next) {
        doc1.once('presence', function(id, presence) {
          expect(presence).to.be.null;
        });

        presence2.destroy(function(error) {
          if (error) return next(error);
          expect(connection2.getPresences(presence2.collection, presence2.id)).to.be.empty;
          expect(doc2._eventsCount).to.equal(0);
          next();
        });
      }
    ], done);
  });

  it('unsubscribes from presence', function(done) {
    async.series([
      doc1.subscribeToPresence.bind(doc1),
      doc2.subscribeToPresence.bind(doc2),
      function(next) {
        presence1.update({index: 1});
        doc2.once('presence', function(id, presence) {
          expect(presence).to.eql({index: 1});
          next();
        });
      },
      function(next) {
        presence2.update({index: 2});
        doc1.once('presence', function(id, presence) {
          expect(presence).to.eql({index: 2});
          next();
        });
      },
      function(next) {
        doc2.once('presence', function(id, presence) {
          expect(presence).to.be.null;
        });

        doc1.unsubscribeFromPresence(function(error) {
          if (error) return next(error);
          expect(connection1.getPresences(presence1.collection, presence1.id)).to.be.empty;
          next();
        });
      },
      function(next) {
        doc1.on('presence', function() {
          done(new Error('Should be unsubscribed'));
        });

        presence2.update({index: 3}, next);
      }
    ], done);
  });

  it('transforms existing remote presence when a new local op is applied', function(done) {
    async.series([
      doc1.subscribeToPresence.bind(doc1),
      function(next) {
        doc1.once('presence', function(id, presence) {
          expect(presence).to.eql({index: 7});
          next();
        });

        presence2.update({index: 7}, errorHandler(done));
      },
      function(next) {
        doc1.once('presence', function(id, presence) {
          expect(doc1.data).to.eql('Northern Lights');
          expect(presence).to.eql({index: 10});
          expect(Object.keys(doc1.remotePresences)).to.have.length(1);
          expect(doc1.remotePresences[id]).to.eql({index: 10});
          next();
        });

        doc1.submitOp({index: 5, value: 'ern'});
      }
    ], done);
  });

  it('transforms existing local presence when a new local op is applied', function(done) {
    async.series([
      presence1.update.bind(presence1, {index: 7}),
      doc1.submitOp.bind(doc1, {index: 5, value: 'ern'}),
      function(next) {
        expect(presence1.value).to.eql({index: 10});
        next();
      }
    ], done);
  });

  it('progresses another client\'s presence when they send an op at their index', function(done) {
    async.series([
      doc1.subscribeToPresence.bind(doc1),
      function(next) {
        presence2.update({index: 5}, errorHandler(done));
        doc1.once('presence', function() {
          next();
        });
      },
      function(next) {
        doc1.once('presence', function(id, presence) {
          expect(presence).to.eql({index: 8});
          next();
        });
        doc2.submitOp({index: 5, value: 'ern'}, errorHandler(done));
      }
    ], done);
  });

  it('does not progress another client\'s index when inserting a local op at their index', function(done) {
    async.series([
      doc1.subscribeToPresence.bind(doc1),
      function(next) {
        presence2.update({index: 5}, errorHandler(done));
        doc1.once('presence', function() {
          next();
        });
      },
      function(next) {
        doc1.once('presence', function(id, presence) {
          expect(presence).to.eql({index: 5});
          next();
        });
        doc1.submitOp({index: 5, value: 'ern'}, errorHandler(done));
      }
    ], done);
  });

  it('waits for pending ops before submitting presence', function(done) {
    async.series([
      doc2.subscribeToPresence.bind(doc2),
      function(next) {
        doc1.submitOp({index: 12, value: ': His Dark Materials'}, errorHandler(done));
        presence1.update({index: 20}, errorHandler(done));

        doc2.once('presence', function(id, presence) {
          expect(presence).to.eql({index: 20});
          expect(doc2.version).to.eql(2);
          next();
        });
      }
    ], done);
  });

  it('queues two updates immediately after one another', function(done) {
    async.series([
      doc2.subscribeToPresence.bind(doc2),
      function(next) {
        presence1.update({index: 4}, errorHandler(done));
        presence1.update({index: 5}, errorHandler(done));

        doc2.once('presence', function(id, presence) {
          expect(presence).to.eql({index: 4});
          doc2.once('presence', function(id, presence) {
            expect(presence).to.eql({index: 5});
            next();
          });
        });
      }
    ], done);
  });

  it('transforms pending presence by another op submitted before a flush', function(done) {
    async.series([
      doc2.subscribeToPresence.bind(doc2),
      function(next) {
        doc1.submitOp({index: 12, value: ': His Dark Materials'}, errorHandler(done));
        presence1.update({index: 20}, errorHandler(done));
        doc1.submitOp({index: 5, value: 'ern'}, errorHandler(done));

        doc2.once('presence', function(id, presence) {
          expect(doc2.version).to.eql(3);
          expect(doc2.data).to.eql('Northern Lights: His Dark Materials');
          expect(presence).to.eql({index: 23});
          next();
        });
      }
    ], done);
  });

  it('requests other client\'s presence when initialising', function(done) {
    async.series([
      presence1.update.bind(presence1, {index: 3}),
      function(next) {
        presence2.update({index: 5}, errorHandler(done));
        doc2.once('presence', function(id, presence) {
          expect(id).to.eql(presence1.presenceId);
          expect(presence).to.eql({index: 3});
          next();
        });
      }
    ], done);
  });

  it('updates the document when the presence version is ahead', function(done) {
    async.series([
      doc1.subscribeToPresence.bind(doc1),
      doc1.unsubscribe.bind(doc1),
      doc2.submitOp.bind(doc2, {index: 5, value: 'ern'}),
      function(next) {
        expect(doc1.version).to.eql(1);
        expect(doc2.version).to.eql(2);

        presence2.update({index: 12}, errorHandler(done));

        doc1.once('presence', function(id, presence) {
          expect(doc1.version).to.eql(2);
          expect(presence).to.eql({index: 12});
          next();
        });
      }
    ], done);
  });

  it('clears presence from a remote client when setting it to null', function(done) {
    async.series([
      doc2.subscribeToPresence.bind(doc2),
      function(next) {
        presence1.update({index: 1}, errorHandler(done));
        doc2.once('presence', function() {
          next();
        });
      },
      function(next) {
        expect(doc2.presences()).to.eql([
          {
            id: 'presence-1',
            data: {index: 1}
          }
        ]);

        presence1.update(null, errorHandler(done));
        doc2.once('presence', function(id, presence) {
          expect(id).to.eql('presence-1');
          expect(presence).to.eql(null);
          expect(doc2.presences()).to.eql([]);
          next();
        });
      }
    ], done);
  });

  it('transforms old presence when its version is behind the latest doc', function(done) {
    async.series([
      doc2.subscribeToPresence.bind(doc2),
      doc1.unsubscribe.bind(doc1),
      doc2.submitOp.bind(doc2, {index: 5, value: 'ern'}),
      function(next) {
        expect(doc1.version).to.eql(1);
        expect(doc2.version).to.eql(2);

        presence1.update({index: 12}, errorHandler(done));
        doc2.once('presence', function(id, presence) {
          expect(doc2.version).to.eql(2);
          expect(presence).to.eql({index: 15});
          next();
        });
      }
    ], done);
  });

  it('transforms old presence when it arrives later than a new op', function(done) {
    async.series([
      doc2.subscribeToPresence.bind(doc2),
      function(next) {
        presencePauser.pause();
        presencePauser.onPause = function() {
          next();
        };
        presence1.update({index: 12}, errorHandler(done));
      },
      function(next) {
        doc1.submitOp({index: 5, value: 'ern'}, errorHandler(done));

        doc2.once('op', function() {
          presencePauser.resume();
        });

        doc2.once('presence', function(id, presence) {
          expect(doc2.version).to.eql(2);
          expect(presence).to.eql({index: 15});
          next();
        });
      }
    ], done);
  });

  // This test case attempts to force us into a tight race condition corner case:
  // 1. doc1 sends presence, as well as submits an op
  // 2. doc2 receives the op first, followed by the presence, which is now out-of-date
  // 3. doc2 re-requests doc1's presence again
  // 4. doc1 sends *another* op, which *again* beats the presence update (this could
  //    in theory happen many times)
  it('transforms old presence when new ops keep beating the presence responses', function(done) {
    async.series([
      doc2.subscribeToPresence.bind(doc2),
      function(next) {
        // Pause presence just before sending it back to the clients. It's already been
        // transformed by the server to what the server knows as the latest version
        presencePauser.pause();
        presencePauser.onPause = function() {
          next();
        };

        presence1.update({index: 12}, errorHandler(done));
      },
      function(next) {
        // Now we submit another op, while the presence is still paused. We wait until
        // doc2 has received this op, so we know that when we finally receive our
        // presence, it will be stale
        doc1.submitOp({index: 5, value: 'ern'}, errorHandler(done));
        doc2.once('op', function() {
          next();
        });
      },
      function(next) {
        // At this point in the test, both docs are up-to-date on v2, but doc2 still
        // hasn't received doc1's v1 presence
        expect(doc1.version).to.eql(2);
        expect(doc2.version).to.eql(2);

        // Resume presence broadcasts so that doc2 receives v1's stale presence
        presencePauser.resume();
        // However, now immediately pause again. Set a conditional pause, which
        // will allow doc2 to request presence from doc1, but will pause doc1's
        // presence response, making it stale again
        presencePauser.pause(function(request) {
          return request.presence.id === 'presence-1';
        });
        presencePauser.onPause = function() {
          // When we capture doc1's response, doc1 also submits some ops, which
          // will make its response stale again.
          doc1.submitOp({index: 0, value: 'The'}, function(error) {
            if (error) return done(error);
            doc1.submitOp({index: 3, value: ' '}, errorHandler(done));
            doc2.on('op', function() {
              // This will get fired for v3 and then v4, so check for the later one
              if (doc1.version === 4 && doc2.version === 4) {
                // Only once doc2 has received the ops, should we resume our
                // broadcasts, ensuring that the update is stale again.
                presencePauser.resume();
                // Despite the second reply being stale, we expect to have transformed it
                // up to the current version.
                doc2.once('presence', function(id, presence) {
                  expect(doc2.version).to.eql(4);
                  expect(presence).to.eql({index: 19});
                  next();
                });
              }
            });
          });
        };
      }
    ], done);
  });

  // This test is for a similar case to the above test case, but ensures that our
  // op cache correctly handles deletion and creation ops
  it('transforms old presence when a doc is deleted and then created', function(done) {
    async.series([
      doc1.subscribeToPresence.bind(doc1),
      doc2.subscribeToPresence.bind(doc2),
      function(next) {
        doc2.once('presence', function() {
          next();
        });

        presence1.update({index: 3}, errorHandler(done));
      },
      function(next) {
        presencePauser.pause();
        presencePauser.onPause = function() {
          next();
        };

        presence1.update({index: 12}, errorHandler(done));
      },
      function(next) {
        doc1.submitOp({index: 5, value: 'ern'}, errorHandler(done));
        doc2.once('op', function() {
          next();
        });
      },
      function(next) {
        expect(doc1.version).to.eql(2);
        expect(doc2.version).to.eql(2);

        presencePauser.resume();
        presencePauser.pause(function(request) {
          return request.presence.id === 'presence-1';
        });
        presencePauser.onPause = function() {
          async.series([
            doc1.del.bind(doc1),
            doc1.create.bind(doc1, 'Subtle Knife', presenceTestType.type.name),
            doc1.submitOp.bind(doc1, {index: 0, value: 'The '})
          ], errorHandler(done));
        };

        doc2.on('op', function() {
          if (doc2.version !== 5) return;
          presencePauser.resume();
          doc2.once('presence', function(id, presence) {
            expect(doc2.version).to.eql(5);
            expect(presence).to.be.null;
            next();
          });
        });
      }
    ], done);
  });

  it('transforms local presence when a doc is deleted and created locally', function(done) {
    async.series([
      presence1.update.bind(presence1, {index: 3}),
      doc1.del.bind(doc1),
      doc1.create.bind(doc1, 'Subtle Knife', presenceTestType.type.uri),
      function(next) {
        expect(presence1.value).to.be.null;
        next();
      }
    ], done);
  });

  it('transforms pending presence by a re-creation submitted before a flush', function(done) {
    async.series([
      doc2.subscribeToPresence.bind(doc2),
      function(next) {
        presence1.update({index: 2}, errorHandler(done));
        doc2.once('presence', function() {
          next();
        });
      },
      function(next) {
        doc1.submitOp({index: 12, value: ': His Dark Materials'}, errorHandler(done));
        presence1.update({index: 20}, errorHandler(done));
        doc1.del(errorHandler(done));
        doc1.create('Subtle Knife', presenceTestType.type.uri, errorHandler(done));

        doc2.on('presence', function(id, presence) {
          if (doc2.version !== 4) return;
          expect(doc2.data).to.eql('Subtle Knife');
          expect(presence).to.be.null;
          next();
        });
      }
    ], done);
  });

  it('ignores presence that arrives out of order', function(done) {
    async.series([
      doc2.subscribeToPresence.bind(doc2),
      function(next) {
        var hasPaused = false;
        // Catch the first presence update, but then allow later ones
        presencePauser.pause(function() {
          if (hasPaused) return false;
          hasPaused = true;
          return true;
        });

        presence1.update({index: 2}, next);
      },
      function(next) {
        doc2.once('presence', function(id, presence) {
          expect(presence).to.eql({index: 3});

          doc2.once('presence', function() {
            done(new Error('should not get another presence event'));
          });

          presencePauser.resume();
          next();
        });

        presence1.update({index: 3}, errorHandler(done));
      }
    ], done);
  });

  it('ignores pending presence that arrives out of order', function(done) {
    async.series([
      doc1.subscribeToPresence.bind(doc1),
      doc1.unsubscribe.bind(doc1),
      doc2.submitOp.bind(doc2, {index: 5, value: 'ern'}),
      function(next) {
        var pauseCount = 0;
        presencePauser.pause();
        presencePauser.onPause = function() {
          pauseCount++;
          if (pauseCount === 2) {
            expect(this._pendingBroadcasts[0][0].presence.p).to.eql({index: 2});
            expect(this._pendingBroadcasts[1][0].presence.p).to.eql({index: 4});
            expect(this._pendingBroadcasts[0][0].presence.seq)
              .to.be.lessThan(this._pendingBroadcasts[1][0].presence.seq);

            // Fire the broadcasts in the reverse order
            this._pendingBroadcasts[1][1]();
            this._pendingBroadcasts[0][1]();
          }
        };

        doc1.once('presence', function(id, presence) {
          expect(presence).to.eql({index: 4});
          next();
        });

        presence2.update({index: 2}, errorHandler(done));
        presence2.update({index: 4}, errorHandler(done));
      }
    ], done);
  });

  it('still sends a response for a presence request that arrives out of order', function(done) {
    async.series([
      doc2.subscribeToPresence.bind(doc2),
      presence2.update.bind(presence2, {index: 10}),
      doc1.subscribeToPresence.bind(doc1),
      function(next) {
        var hasPaused = false;
        // Catch the first presence update, but then allow later ones
        presencePauser.pause(function() {
          if (hasPaused) return false;
          hasPaused = true;
          return true;
        });

        presence1.update({index: 2}, {requestPresence: true}, errorHandler(done));
        presence1.update({index: 3}, errorHandler(done));

        doc2.once('presence', function(id, presence) {
          expect(presence).to.eql({index: 3});
          presencePauser.resume();
          doc1.once('presence', function(id, presence) {
            expect(presence).to.eql({index: 10});
            next();
          });
        });
      }
    ], done);
  });

  it('rejects a presence message with a numeric collection', function(done) {
    // Set up a doc with the wrong connection to capture the error. In
    // "normal" operation, this would probably be an uncaught error.
    var badDoc = connection1.get(1, 'northern-lights');
    badDoc.on('error', function(error) {
      expect(error.code).to.eql(4000);
      done();
    });

    var message = presence1._message();
    message.c = 1;
    message.v = 1;
    message.t = presenceTestType.type.uri;
    connection1.send(message);
  });

  it('rejects a presence message with an invalid version', function(done) {
    presence1.on('error', function(error) {
      expect(error.code).to.eql(4000);
      done();
    });

    var message = presence1._message();
    message.v = -1;
    message.t = presenceTestType.type.uri;
    connection1.send(message);
  });

  it('rejects a presence message without an ID', function(done) {
    doc1.on('error', function(error) {
      expect(error.code).to.eql(4000);
      done();
    });

    var message = presence1._message();
    message.id = null;
    message.v = 1;
    message.t = presenceTestType.type.uri;
    connection1.send(message);
  });

  it('only sends presence responses for the given doc', function(done) {
    var otherDoc1 = connection1.get('books', 'subtle-knife');
    var otherDoc2 = connection2.get('books', 'subtle-knife');
    var otherPresence1 = connection1.getPresence('books', 'subtle-knife', 'other-presence-1');
    var otherPresence2 = connection2.getPresence('books', 'subtle-knife', 'other-presence-2');

    async.series([
      otherDoc1.create.bind(otherDoc1, 'Subtle Knife', presenceTestType.type.uri),
      otherDoc2.subscribe.bind(otherDoc2),
      otherPresence1.update.bind(otherPresence1, {index: 0}),
      otherPresence2.update.bind(otherPresence2, {index: 0}),
      presence1.update.bind(presence1, {index: 3}),
      function(next) {
        presence2.update({index: 5}, {requestPresence: true}, next);
        otherDoc2.on('presence', function() {
          done(new Error('Other document should not have had presence sent'));
        });
      }
    ], done);
  });

  it('sends the presence data once the connection can send', function(done) {
    async.series([
      doc1.subscribeToPresence.bind(doc1),
      function(next) {
        connection2._setState('disconnected');
        presence2.update({index: 1}, errorHandler(done));

        doc2.whenNothingPending(function() {
          // The connection tests whether we can send just before sending on
          // nothing pending, so let's also wait to reset the connection.
          connection2._setState('connecting');
          connection2._setState('connected');
        });

        doc1.once('presence', function(id, presence) {
          expect(presence).to.eql({index: 1});
          next();
        });
      }
    ], done);
  });

  it('un-transforms presence after a soft rollback', function(done) {
    // Mock invert so that we can trigger a soft rollback instead of a hard rollback
    presenceTestType.type.invert = function() {
      return {index: 5, del: 3};
    };

    async.series([
      doc1.subscribeToPresence.bind(doc1),
      presence1.update.bind(presence1, {index: 7}),
      function(next) {
        presence2.update({index: 8}, errorHandler(done));
        doc1.once('presence', function() {
          next();
        });
      },
      function(next) {
        backend.use(backend.MIDDLEWARE_ACTIONS.apply, function(request, callback) {
          callback({code: 4002});
        });

        doc1.once('presence', function() {
          expect(presence1.value).to.eql({index: 10});
          expect(doc1.presences()).to.eql([{
            id: 'presence-2',
            data: {index: 11}
          }]);

          doc1.once('presence', function() {
            expect(presence1.value).to.eql({index: 7});
            expect(doc1.presences()).to.eql([{
              id: 'presence-2',
              data: {index: 8}
            }]);
            next();
          });
        });

        doc1.submitOp({index: 5, value: 'ern'}, errorHandler(done));
      }
    ], done);
  });

  it('performs a hard reset on presence when the doc is hard rolled back', function(done) {
    async.series([
      doc1.subscribeToPresence.bind(doc1),
      presence1.update.bind(presence1, {index: 7}),
      function(next) {
        presence2.update({index: 8}, errorHandler(done));
        doc1.once('presence', function() {
          next();
        });
      },
      function(next) {
        backend.use(backend.MIDDLEWARE_ACTIONS.apply, function(request, callback) {
          callback({code: 4002});
        });

        doc1.once('presence', function() {
          expect(presence1.value).to.eql({index: 10});
          expect(doc1.presences()).to.eql([{
            id: 'presence-2',
            data: {index: 11}
          }]);

          doc1.once('presence', function() {
            expect(presence1.value).to.eql(null);
            expect(doc1.presences()).to.eql([]);
            next();
          });
        });

        doc1.submitOp({index: 5, value: 'ern'}, errorHandler(done));
      }
    ], done);
  });

  it('can create presence before performing the first fetch on a document', function(done) {
    var connection3 = backend.connect();
    var doc3 = connection3.get('books', 'northern-lights');
    var presence3 = connection3.getPresence('books', 'northern-lights', 'presence-3');

    async.series([
      doc1.subscribeToPresence.bind(doc1),
      doc3.fetch.bind(doc3),
      function(next) {
        presence3.update({index: 1}, errorHandler(done));
        doc1.once('presence', function(id, presence) {
          expect(id).to.eql('presence-3');
          expect(presence).to.eql({index: 1});
          next();
        });
      }
    ], done);
  });

  it('errors when submitting presence on a document that has not been created', function(done) {
    async.series([
      doc1.del.bind(doc1),
      function(next) {
        presence1.update({index: 2}, function(error) {
          expect(error.code).to.eql(9999);
          next();
        });
      }
    ], done);
  });

  it('errors when trying to submit presence on a type that does not support it', function(done) {
    var jsonDoc = connection1.get('books', 'snuff');
    var jsonPresence = connection1.getPresence('books', 'snuff', 'json-presence');

    async.series([
      jsonDoc.create.bind(jsonDoc, {title: 'Snuff'}, 'json0'),
      function(next) {
        jsonPresence.update({index: 1}, function(error) {
          expect(error.code).to.eql(9999);
          next();
        });
      }
    ], done);
  });

  // Helper middleware for precise control over when clients receive
  // presence updates
  function PresencePauser() {
    // Handler that can be set to be called when a message
    // is paused
    this.onPause = null;
    this._shouldPause = false;
    this._pendingBroadcasts = [];

    // Main middleware method
    this.sendPresence = function(request, callback) {
      if (!this._isPaused(request)) return callback();
      this._pendingBroadcasts.push([request, callback]);
      if (typeof this.onPause === 'function') {
        this.onPause(request);
      }
    };

    // If called without an argument, will pause all broadcasts.
    // If called with a function, the returned result will determine
    // whether the request is paused
    this.pause = function(predicate) {
      this._shouldPause = typeof predicate === 'function' ? predicate : true;
    };

    // Send all paused broadcasts, and unpause. Also unsets the onPause
    // handler
    this.resume = function() {
      this._shouldPause = false;
      this._pendingBroadcasts.forEach(function(broadcast) {
        var callback = broadcast[1];
        callback();
      });
      this._pendingBroadcasts = [];
      this.onPause = null;
    };

    this._isPaused = function(request) {
      return this._shouldPause === true ||
        typeof this._shouldPause === 'function' && this._shouldPause(request);
    };
  }
});
