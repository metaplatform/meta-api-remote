/*
 * META API
 *
 * @author META Platform <www.meta-platform.com>
 * @license See LICENSE file distributed with this source code
 */

var ws = require("ws");
var crypto = require("crypto");

var EventEmitter = require('events').EventEmitter;
var Utils = require("meta-api-shared").Utils;
var Types = require("meta-api-shared").Types;
var protocol = require("meta-api-shared").protocol;

/*
 * Remote WebSocket connection
 *
 * @param Broker broker
 * @param String clientId
 */
var Connection = function(serviceName, handleCall, handleMessage, handleQueueMessage){

	this.serviceName = serviceName;

	this.callHandler = handleCall;
	this.messageHandler = handleMessage;
	this.queueMessageHandler = handleQueueMessage;

	this.activeSubscriptions = [];
	this.commandQueue = [];

	this.brokerUrl = null;
	this.credentials = null;

	this.ws = null;
	this.active = false;
	this.reconnectTimeout = 3000;
	this.reconnect = true;
	this.reconnectionTimer = null;

	this.reqId = 0;
	this.requests = {};

};

Connection.prototype = Object.create(EventEmitter.prototype);

/*
 * Sends request over socket
 *
 * @param Integer command
 * @param Object params
 * @param Function cb
 */
Connection.prototype.sendRequest = function(command, params, cb){

	if(!this.active) throw new Error("Not connected.");

	this.reqId++;
	var rid = "c" + this.reqId;

	this.requests[rid] = cb;

	var msg = JSON.stringify({
		r: rid,
		c: command,
		p: params || {}
	});

	if(this.ws)
		this.ws.send(msg);
	else
		this.commandQueue.push(msg);

};

/*
 * Sends response
 *
 * @param Integer command
 * @param Object params
 * @param Function cb
 */
Connection.prototype.sendResponse = function(rid, data, command){

	if(!this.active) throw new Error("Not connected.");

	var res;

	if(data instanceof Error)
		res = { r: rid, c: protocol.commands.error, e: { code: data.code || 500, message: data.message }};
	else if(data instanceof Object && Object.getPrototypeOf(data)._type)
		res = { r: rid, c: command || protocol.commands.response, d: data, t: Object.getPrototypeOf(data)._type };
	else
		res = { r: rid, c: command || protocol.commands.response, d: data };

	var msg = JSON.stringify(res);

	if(this.ws)
		this.ws.send(msg);
	else
		this.commandQueue.push(msg);

};

/*
 * Handles websocket response
 *
 * @param String rid
 * @param Mixed data
 */
Connection.prototype.handleResponse = function(rid, err, data, type){

	if(!this.requests[rid])
		return;

	var cb = this.requests[rid];
	delete this.requests[rid];

 	var res;

 	if(type == "ApiReference")
 		res = new Types.ApiReference(data.service, data.endpoint);
 	else if(type == "ChannelReference")
 		res = new Types.ChannelReference(data.service, data.endpoint, data.id);
 	else if(type == "StorageReference")
 		res = new Types.StorageReference(data.bucket, data.objectId);
 	else
 		res = data;

	cb(err, res);

};

Connection.prototype.handleSocketMessage = function(msg){

	var self = this;

	try {

		var data = JSON.parse(msg);
		var req = null;

		if(!data.r || !data.c)
			return this.sendResponse(null, new Error("Invalid request."));

		switch(data.c){

			case protocol.commands.hello:
				return;

			case protocol.commands.response:
				this.handleResponse(data.r, null, data.d, data.t);
				return;
			case protocol.commands.error:
				this.handleResponse(data.r, new Error(data.e.message));
				return;

			case protocol.commands.cliCall:
				if(!data.p.endpoint || !data.p.method) return this.sendResponse(new Error("Invalid request params."));
				req = this.receiveCall(data.p.endpoint, data.p.method, data.p.params || {});
				break;

			case protocol.commands.cliMessage:
				if(!data.p.channel || !data.p.message) return this.sendResponse(new Error("Invalid request params."));
				req = this.receiveMessage(data.p.channel, data.p.message);
				break;

			case protocol.commands.cliQueueMessage:
				if(!data.p.queue || !data.p.message) return this.sendResponse(new Error("Invalid request params."));
				req = this.receiveQueueMessage(data.p.queue, data.p.message);
				break;

			default:
				return this.sendResponse(data.r, new Error("Undefined command."));

		}

		req.then(function(res){

			self.sendResponse(data.r, res);

		}, function(err){

			self.sendResponse(data.r, err);

		});

	} catch(e){

		this.sendResponse(null, new Error("Invalid request format. Cannot parse JSON."));

	}

};

Connection.prototype.createConnection = function(){

	var self = this;

	if(this.ws)
		throw new Error("Already connected.");

	//Reconnect handler
	var reconnect = function(){

		if(self.reconnectionTimer) return ;

		self.reconnectionTimer = setTimeout(function(){

			self.reconnectionTimer = null;
			self.createConnection();

		}, self.reconnectTimeout);

	};

	//Open connection
	this.ws = ws(this.brokerUrl);

	this.ws.on("open", function(){

		//Set active
		self.active = true;

		//Create token
		var now = new Date();
		var timestr = now.getFullYear() + ":" + now.getMonth() + ":" + now.getDate() + ":" + now.getHours();
		var token = crypto.createHash("sha256").update(self.serviceName + self.secret + timestr).digest("hex");

		//Send auth request
		self.sendRequest(protocol.commands.auth, {
			serviceName: self.serviceName,
			token: token
		}, function(res){

			if(res instanceof Error)
				self.emit("connectionError", res);

			//Subscribe active channels					
			var tasks = [];

			for(var s in self.activeSubscriptions)
				tasks.push(self.subscribe(self.activeSubscriptions[s]));

			Promise.all(tasks).then(function(){

				//Flush command queue
				var msg = true;

				while(msg){
					msg = self.commandQueue.shift();
					self.ws.send(msg);
				}

				//Ready
				self.emit("open");

			}, function(err){
				
				self.emit("connectionError", err);

			});

		});

	});

	this.ws.on("close", function(code){

		if(code == 1006 && self.reconnect){

			self.ws = null;
			self.emit("reconnect", new Error("Connection lost."));

			reconnect();

		} else {

			self.close();

		}

	});

	this.ws.on("message", function(msg){

		self.handleSocketMessage(msg);

	});

	this.ws.on("error", function(err){

		if(err.code == 'ECONNREFUSED' && self.reconnect){
			
			self.ws = null;
			self.emit("reconnect", new Error("Connection refused."));
			reconnect();

		} else {

			self.emit("connectionError", err);

		}

	});

};

/*
 * Connects to remote broker
 *
 * @param String brokerUrl
 * @return Promise
 * @resolve true
 */
Connection.prototype.connect = function(brokerUrl, secret){

	var self = this;

	this.brokerUrl = brokerUrl;
	this.secret = secret;

	if(this.reconnect)
		this.active = true;

	return new Promise(function(resolve, reject){

		try {

			self.createConnection();
			
			self.once("open", function(){
				resolve();
			});

			self.once("connectionError", function(err){
				reject(err);
			});

		} catch(e){
			reject(e);
		}

	});

};

/*
 * Closes connection
 */
Connection.prototype.close = function(){

	if(this.ws)
		this.ws.close();

	this.ws = null;
	this.active = false;

	this.activeSubscriptions = [];
	this.commandQueue = [];

	this.emit("close");

};

/*
 * Request method call
 *
 * @param String endpoint
 * @param String method
 * @param Object params
 * @return Promise
 * @resolve Mixed
 */
Connection.prototype.receiveCall = function(endpoint, method, params){

	return this.callHandler(endpoint, method, Utils.clone(params));

};

/*
 * Request publish
 *
 * @param String channel
 * @param Object message
 * @void
 */
Connection.prototype.receiveMessage = function(channel, message){

	return this.messageHandler(channel, Utils.clone(message));

};

/*
 * Request queue publish
 *
 * @param String queue
 * @param Object message
 * @return Promise
 * @resolve Boolean if true, then message is removed otherwise message is passed to another receiver
 */
Connection.prototype.receiveQueueMessage = function(queue, message){

	return this.queueMessageHandler(queue, Utils.clone(message));

};

/*
 * RPC call
 *
 * @param String service
 * @param String endpoint
 * @param String method
 * @param Object params
 * @return Promise
 * @resolve Object
 */
Connection.prototype.call = function(service, endpoint, method, params){

	var self = this;

	return new Promise(function(resolve, reject){

		try {
			
			self.sendRequest(protocol.commands.srvCall, {
				service: service,
				endpoint: endpoint,
				method: method,
				params: params || {}
			}, function(err, res){
				
				if(err)
					reject(err);
				else
					resolve(res);

			});

		} catch(e){
			reject(e);
		}

	});

};

/*
 * Subscribe to channel
 *
 * @param String channel
 * @return Promise
 */
Connection.prototype.subscribe = function(channel){

	var self = this;

	return new Promise(function(resolve, reject){

		try {
			
			self.sendRequest(protocol.commands.srvSubscribe, {
				channel: channel
			}, function(err, res){
				
				if(err) return reject(err);
				
				if(self.activeSubscriptions.indexOf(channel) < 0)
					self.activeSubscriptions.push(channel);

				resolve(res);

			});

		} catch(e){
			reject(e);
		}

	});

};

/*
 * Unsubscribe from channel
 *
 * @param String channel
 * @return Promise
 * @resolve true
 */
Connection.prototype.unsubscribe = function(channel){

	var self = this;

	return new Promise(function(resolve, reject){

		try {
			
			self.sendRequest(protocol.commands.srvUnsubscribe, {
				channel: channel
			}, function(err,res){
				
				if(err) return reject(err);
				
				var i = self.activeSubscriptions.indexOf(channel);

				if(i >= 0) self.activeSubscriptions.splice(i, 1);

				resolve(res);

			});

		} catch(e){
			reject(e);
		}

	});

};

/*
 * Publish message
 *
 * @param String channel
 * @param Object message
 * @return Promise
 * @resolve Integer
 */
Connection.prototype.publish = function(channel, message){

	var self = this;

	return new Promise(function(resolve, reject){

		try {
			
			self.sendRequest(protocol.commands.srvPublish, {
				channel: channel,
				message: message
			}, function(err, res){

				if(err)
					reject(err);
				else
					resolve(res);

			});

		} catch(e){
			reject(e);
		}

	});
	
};

/*
 * Get subscriber count
 *
 * @param String channel
 * @return Promise
 * @resolve Intger
 */
Connection.prototype.subscribers = function(channel){

	var self = this;

	return new Promise(function(resolve, reject){

		try {
			
			self.sendRequest(protocol.commands.srvSubscribers, {
				channel: channel
			}, function(err, res){

				if(err)
					reject(err);
				else
					resolve(res);

			});

		} catch(e){
			reject(e);
		}

	});
	
};

/*
 * Subscribe to queue messages
 *
 * @param String queue
 * @return Promise
 */
Connection.prototype.subscribeQueue = function(queue){

	var self = this;

	return new Promise(function(resolve, reject){

		try {
			
			self.sendRequest(protocol.commands.srvSubscribeQueue, {
				queue: queue
			}, function(err, res){

				if(err)
					reject(err);
				else
					resolve(res);

			});

		} catch(e){
			reject(e);
		}

	});

};

/*
 * Unsubscribe from queue messages
 *
 * @param String queue
 * @return Promise
 * @resolve true
 */
Connection.prototype.unsubscribeQueue = function(queue){

	var self = this;

	return new Promise(function(resolve, reject){

		try {
			
			self.sendRequest(protocol.commands.srvUnsubscribeQueue, {
				queue: queue
			}, function(err, res){

				if(err)
					reject(err);
				else
					resolve(res);

			});

		} catch(e){
			reject(e);
		}

	});

};

/*
 * Enqueue message
 *
 * @param String queue
 * @param Object message
 * @param Integer|null ttl
 * @return Promise
 * @resolve true
 */
Connection.prototype.enqueue = function(queue, message, ttl){

	var self = this;

	return new Promise(function(resolve, reject){

		try {
			
			self.sendRequest(protocol.commands.srvEnqueue, {
				queue: queue,
				message: message
			}, function(err, res){

				if(err)
					reject(err);
				else
					resolve(res);

			});

		} catch(e){
			reject(e);
		}

	});
	
};

//EXPORT
module.exports = Connection;