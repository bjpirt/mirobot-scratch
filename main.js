(function(ext) {

  // Include the main Mirobot class for connecting
  var Mirobot = function(url){
    this.url = url;
    if(url) this.connect();
    this.cbs = {};
    this.listeners = [];
    this.sensorState = {follow: null, collide: null};
    this.collideListening = false;
    this.followListening = false;
  }

  Mirobot.prototype = {

    connected: false,
    error: false,
    timeoutTimer: undefined,
    simulating: false,
    sim: undefined,

    connect: function(url){
      if(url) this.url = url;
      if(!this.connected && !this.error && this.url){
        var self = this;
        this.has_connected = false;
        this.ws = new WebSocket(this.url);
        this.ws.onmessage = function(ws_msg){self.handle_msg(ws_msg)};
        this.ws.onopen = function(){
          self.connected = true;
          self.version(function(){
            self.setConnectedState(true);
          });
        }
        this.ws.onerror = function(err){self.handleError(err)}
        this.ws.onclose = function(err){self.handleError(err)}
        this.connTimeout = window.setTimeout(function(){
          if(!self.connected){
            self.ws.close();
          }
        }, 1000);
      }
    },

    disconnect: function(){
      this.connected = false;
      this.error = false
      this.ws.onerror = function(){};
      this.ws.onclose = function(){};
      this.ws.close();
    },

    setConnectedState: function(state){
      var self = this;
      clearTimeout(self.connTimeout);
      self.connected = state;
      if(state){ self.has_connected = true; }
      setTimeout(function(){
        self.emitEvent('readyStateChange', {state: (self.ready() ? 'ready' : 'notReady')});
        self.emitEvent('connectedStateChange', {state: (self.connected ? 'connected' : 'disconnected')});
      }, 500);
      // Try to auto reconnect if disconnected
      if(state){
        if(self.reconnectTimer){
          clearTimeout(self.reconnectTimer);
          self.reconnectTimer = undefined;
        }
      }else{
        if(!self.reconnectTimer){
          self.reconnectTimer = setTimeout(function(){
            self.reconnectTimer = undefined;
            self.connect();
          }, 5000);
        }
      }
    },

    ready: function(){
      return this.connected || this.simulating;
    },

    setSimulator: function(sim){
      this.sim = sim;
    },

    setSimulating: function(s){
      this.simulating = s;
      this.emitEvent('readyStateChange', {state: (this.ready() ? 'ready' : 'notReady')});
    },
  
    emitEvent: function(event, msg){
      if(typeof this.listeners[event] !== 'undefined'){
        for(var i = 0; i< this.listeners[event].length; i++){
          this.listeners[event][i](msg);
        }
      }
    },

    addEventListener: function(event, listener){
      this.listeners[event] =  this.listeners[event] || [];
      this.listeners[event].push(listener);
    },

    handleError: function(err){
      if(err instanceof CloseEvent || err === 'Timeout'){
        if(this.ws.readyState === WebSocket.OPEN){
          this.ws.close();
        }
        this.msg_stack = [];
      }else{
        console.log(err);
      }
      this.setConnectedState(false);
    },

    move: function(direction, distance, cb){
      this.send({cmd: direction, arg: distance}, cb);
    },

    turn: function(direction, angle, cb){
      if(angle < 0){
        angle = -angle;
        direction = (direction === 'left' ? 'right' : 'left')
      }
      this.send({cmd: direction, arg: angle}, cb);
    },
  
    forward: function(distance, cb){
      this.move('forward', distance, cb);
    },
  
    back: function(distance, cb){
      this.move('back', distance, cb);
    },
  
    left: function(angle, cb){
      this.turn('left', angle, cb);
    },
  
    right: function(angle, cb){
      this.turn('right', angle, cb);
    },

    penup: function(cb){
      this.send({cmd: 'penup'}, cb);
    },

    pendown: function(cb){
      this.send({cmd: 'pendown'}, cb);
    },

    beep: function(duration, cb){
      this.send({cmd: 'beep', arg: duration}, cb);
    },

    collide: function(cb){
      this.send({cmd: 'collide'}, cb);
    },

    follow: function(cb){
      this.send({cmd: 'follow'}, cb);
    },

    slackCalibration: function(cb){
      this.send({cmd: 'slackCalibration'}, cb);
    },

    moveCalibration: function(cb){
      this.send({cmd: 'moveCalibration'}, cb);
    },

    turnCalibration: function(cb){
      this.send({cmd: 'turnCalibration'}, cb);
    },

    calibrateSlack: function(steps, cb){
      this.send({cmd: 'calibrateSlack', arg: "" + steps}, cb);
    },

    calibrateMove: function(factor, cb){
      this.send({cmd: 'calibrateMove', arg: "" + factor}, cb);
    },

    calibrateTurn: function(factor, cb){
      this.send({cmd: 'calibrateTurn', arg: "" + factor}, cb);
    },

    collideState: function(cb){
      if(this.sensorState.collide === null || !this.collideListening){
        var self = this;
        this.send({cmd: 'collideState'}, function(state, msg){
          if(state === 'complete'){
            self.sensorState.collide = msg.msg;
            cb(self.sensorState.collide);
          }
        });
      }else{
        cb(this.sensorState.collide);
      }
    },

    followState: function(cb){
      if(this.sensorState.follow === null || !this.followListening){
        var self = this;
        this.send({cmd: 'followState'}, function(state, msg){
          if(state === 'complete'){
            self.sensorState.follow = msg.msg;
            cb(self.sensorState.follow);
          }
        });
      }else{
        cb(this.sensorState.follow);
      }
    },

    collideSensorNotify: function(state, cb){
      var self = this;
      this.send({cmd: 'collideNotify', arg: (state ? 'true' : 'false')}, function(){
        self.collideListening = true;
        cb();
      });
    },

    followSensorNotify: function(state, cb){
      var self = this;
      this.send({cmd: 'followNotify', arg: (state ? 'true' : 'false')}, function(){
        self.followListening = true;
        cb();
      });
    },

    stop: function(cb){
      var self = this;
      this.send({cmd:'stop'}, function(state, msg, recursion){
        if(state === 'complete' && !recursion){
          for(var i in self.cbs){
            self.cbs[i]('complete', undefined, true);
          }
          self.emitEvent('programComplete');
          self.robot_state = 'idle';
          self.msg_stack = [];
          self.cbs = {};
          if(cb){ cb(state); }
        }
      });
    },
  
    pause: function(cb){
      this.send({cmd:'pause'}, cb);
    },
  
    resume: function(cb){
      this.send({cmd:'resume'}, cb);
    },
  
    ping: function(cb){
      this.send({cmd:'ping'}, cb);
    },

    version: function(cb){
      this.send({cmd:'version'}, cb);
    },

    send: function(msg, cb){
      msg.id = Math.random().toString(36).substr(2, 10)
      if(cb){
        this.cbs[msg.id] = cb;
      }
      if(msg.arg){ msg.arg = msg.arg.toString(); }
      if(['stop', 'pause', 'resume', 'ping', 'version'].indexOf(msg.cmd) >= 0){
        this.send_msg(msg);
      }else{
        if(this.msg_stack.length === 0){
          this.emitEvent('programStart');
        }
        this.msg_stack.push(msg);
        this.process_msg_queue();
      }
    },
  
    send_msg: function(msg){
      var self = this;
      console.log(msg);
      if(this.simulating && this.sim){
        this.sim.send(msg, function(msg){ self.handle_msg(msg) });
      }else if(this.connected){
        this.ws.send(JSON.stringify(msg));
        if(this.timeoutTimer) clearTimeout(this.timeoutTimer);
        this.timeoutTimer = window.setTimeout(function(){ self.handleError("Timeout") }, 3000);
      }
    },
  
    process_msg_queue: function(){
      if(this.robot_state === 'idle' && this.msg_stack.length > 0){
        this.robot_state = 'receiving';
        this.send_msg(this.msg_stack[0]);
      }
    },
  
    handle_msg: function(msg){
      if(typeof msg === 'object' && typeof msg.data === 'string') msg = JSON.parse(msg.data);
      console.log(msg);
      clearTimeout(this.timeoutTimer);
      if(msg.status === 'notify'){
        this.emitEvent(msg.id);
        this.sensorState[msg.id] = msg.msg;
        return;
      }
      if(this.msg_stack.length > 0 && this.msg_stack[0].id == msg.id){
        if(msg.status === 'accepted'){
          if(this.cbs[msg.id]){
            this.cbs[msg.id]('started', msg);
          }
          this.robot_state = 'running';
        }else if(msg.status === 'complete'){
          if(this.cbs[msg.id]){
            this.cbs[msg.id]('complete', msg);
            delete this.cbs[msg.id];
          }
          this.msg_stack.shift();
          if(this.msg_stack.length === 0){
            this.emitEvent('programComplete');
          }
          this.robot_state = 'idle';
          this.process_msg_queue();
        }
      }else{
        if(this.cbs[msg.id]){
          this.cbs[msg.id]('complete', msg);
          delete this.cbs[msg.id];
        }
      }
      if(msg.status && msg.status === 'error' && msg.msg === 'Too many connections'){
        this.error = true;
        this.emitEvent('error');
      }
    },
  
    robot_state: 'idle',
    msg_stack: []
  }

  var m = new Mirobot();

  var devices = {};

  // Cleanup function when the extension is unloaded
  ext._shutdown = function() {};

  // Status reporting code
  ext._getStatus = function() {
      return {status: 2, msg: 'Ready'};
  };

  ext.autoconnect = function(arg1, arg2) {
    var host;
    var cb;
    if(m.connected) return callback();
    m.addEventListener('connectedStateChange',  function(msg){
      if(msg.state === 'connected'){
        cb();
      }
    });
    if(Object.keys(devices).length === 1){
      host = Object.keys(devices)[0];
      cb = arg1;
    }else if(Object.keys(devices).length > 1){
      var name = arg1;
      for(var h in devices){
        if(devices[h].name === arg1){
          host = h;
          break;
        }
      }
      cb = arg2;
    }
    m.connect('ws://' + host + ':8899/websocket');
  };

  ext.connect = function(address, callback) {
    if(m.connected) return callback();
    m.addEventListener('connectedStateChange',  function(msg){
      if(msg.state === 'connected'){
        callback();
      }
    });
    m.connect('ws://' + address + ':8899/websocket');
  };

  ext.forward = function(distance, callback) {
    m.forward(distance, function(state, msg){
      if(state === 'complete'){
        callback();
      }
    });
  };

  ext.back = function(distance, callback) {
    m.back(distance, function(state, msg){
      if(state === 'complete'){
        callback();
      }
    });
  };

  ext.left = function(angle, callback) {
    m.left(angle, function(state, msg){
      if(state === 'complete'){
        callback();
      }
    });
  };

  ext.right = function(angle, callback) {
    m.right(angle, function(state, msg){
      if(state === 'complete'){
        callback();
      }
    });
  };

  ext.penup = function(callback) {
    m.penup(function(state, msg){
      if(state === 'complete'){
        callback();
      }
    });
  };

  ext.pendown = function(callback) {
    m.pendown(function(state, msg){
      if(state === 'complete'){
        callback();
      }
    });
  };

  ext.beep = function(duration, callback) {
    m.beep(duration * 1000, function(state, msg){
      if(state === 'complete'){
        callback();
      }
    });
  };

  ext.stop = function(callback) {
    m.stop(function(state, msg){
      if(state === 'complete'){
        callback();
      }
    });
  };

  ext.bumpSensor = function(callback) {
    m.collideState(function(state){
      callback(state);
    });
  };

  ext.lineSensor = function(callback) {
    m.followState(function(state){
      callback(state);
    });
  };

  //
  // bump sensor notifications
  //
  var hasBumped = false
  var bumpHandler = function(){
    hasBumped = true;
  }
  
  var bumpSetup = false;
  ext.bumpSensorChange = function(callback) {
    if(!bumpSetup && m.connected){
      bumpSetup = true;
      m.collideSensorNotify(true, function(){
        m.addEventListener('collide', bumpHandler);
      });
    }
    if(hasBumped){
      hasBumped = false;
      return true;
    }
    return false;
  };
  
  //
  // Line follower notifications
  //
  var lineHasChanged = false
  var lineHandler = function(){
    lineHasChanged = true;
  }
  
  var lineSetup = false;
  ext.lineSensorChange = function(callback) {
    if(!lineSetup && m.connected){
      lineSetup = true;
      m.collideSensorNotify(true, function(){
        m.addEventListener('collide', lineHandler);
      });
    }
    if(lineHasChanged){
      lineHasChanged = false;
      return true;
    }
    return false;
  };

  // Block and block menu descriptions
  var descriptor = function(){
    var blocks = [];
    var deviceNames = [];
    if(Object.keys(devices).length === 1){
      blocks.push(['w', 'connect to ' + devices[Object.keys(devices)[0]].name, 'autoconnect'])
    }else if(Object.keys(devices).length > 1){
      blocks.push(['w', 'connect to %m.deviceNames', 'autoconnect', devices[Object.keys(devices)[0]].name])
      deviceNames = Object.keys(devices).map(function(k){
        return devices[k].name;
      });
    }
    blocks = blocks.concat([
        ['w', 'connect to Mikeybot: %s',                'connect', 'local.mirobot.io'],
        ['w', 'move forward by %n mm',                 'forward', 100],
        ['w', 'move back by %n mm',                    'back', 100],
        ['w', 'turn left by %n degrees',               'left', 90],
        ['w', 'turn right by %n degrees',              'right', 90],
        ['w', 'pen up',                                'penup'],
        ['w', 'pen down',                              'pendown'],
        ['w', 'beep for %n seconds',                   'beep', 0.5],
        ['w', 'stop',                                  'stop'],
        ['R', 'bump sensor',                           'bumpSensor'],
        ['R', 'line sensor',                           'lineSensor'],
        ['h', 'when I bump into something',            'bumpSensorChange'],
        ['h', 'when the line sensor changes',          'lineSensorChange']
    ])
    return {
      blocks: blocks,
      menus: { deviceNames: deviceNames },
      url: 'http://mirobot.io'
    };
  }
  

  function reloadExtension() {
    ScratchExtensions.unregister('Mikeybot extension');
    ScratchExtensions.register('Mikeybot extension', descriptor(), ext);
  }
  
  var fetchDevices = function(){
    var req = new XMLHttpRequest();
    req.addEventListener("load", function(){
      var resp = JSON.parse(this.responseText);
      if(resp.devices && resp.devices.length > 0){
        for(var i = 0; i< resp.devices.length; i++){
          devices[resp.devices[i].address] = resp.devices[i];
        }
        console.log(devices);
        reloadExtension();
      }
    });
    req.addEventListener("error", function(e){
      console.log('Error fetching devices list');
      console.log(e);
    });
    req.open("GET", "http://local.mirobot.io/devices.json");
    req.send();
  }
  fetchDevices();
  reloadExtension();
})({});
