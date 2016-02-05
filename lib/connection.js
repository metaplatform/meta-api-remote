/*
 * META API
 *
 * @author META Platform <www.meta-platform.com>
 * @license See LICENSE file distributed with this source code
 */

var ws = require("ws");

var EventEmitter = require('events').EventEmitter;
var Utils = require("meta-api-shared").Utils;
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

	this.brokerUrl = null;
	this.ws = null;

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

	if(!this.ws) throw new Error("Not connected.");

	this.reqId++;
	var rid = "c" + this.reqId;

	this.requests[rid] = cb;

	this.ws.send(JSON.stringify({
		r: rid,
		c: command,
		p: params || {}
	}));

};

/*
 * Sends response
 *
 * @param Integer command
 * @param Object params
 * @param Function cb
 */
Connection.prototype.sendResponse = function(rid, data, command){

	if(!this.ws) throw new Error("Not connected.");

	var res;

	if(data instanceof Error)
		res = { r: rid, c: protocol.commands.error, e: { code: data.code || 500, message: data.message }};
	else
		res = { r: rid, c: command || protocol.commands.response, d: data };

	this.ws.send(JSON.stringify(res));

};

/*
 * Handles websocket response
 *
 * @param String rid
 * @param Mixed data
 */
Connection.prototype.handleResponse = function(rid, err, data){

	if(!this.requests[rid])
		return;

	var cb = this.requests[rid];
	delete this.requests[rid];

	cb(err, data);

};

Connection.prototype.handleSocketMessage = function(msg){

	try {

		var data = JSON.parse(msg);
		var req = null;

		if(!data.r || !data.c)
			return this.sendRespond(null, new Error("Invalid request."));

		switch(data.c){

			case protocol.commands.hello:
				return;

			case protocol.commands.response:
				this.handleResponse(data.r, null, data.d);
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
				req = this.receiveMessage(data.p.channel, data.p.message, data.p.params || {});
				break;

			case protocol.commands.cliQueueMessage:
				if(!data.p.queue || !data.p.message) return this.sendResponse(new Error("Invalid request params."));
				req = this.receiveQueueMessage(data.p.queue, data.p.message, data.p.params || {});
				break;

			default:
				return this.sendResponse(data.r, new Error("Undefined command."));

		}

		req.then(function(res){

			this.sendResponse(data.r, res);

		}, function(err){

			this.sendResponse(data.r, err);

		});

	} catch(e){

		this.sendResponse(null, new Error("Invalid request format. Cannot parse JSON."));

	}

};

/*
 * Connects to remote broker
 *
 * @param String brokerUrl
 * @return Promise
 * @resolve true
 */
Connection.prototype.connect = function(brokerUrl){

	var self = this;

	return new Promise(function(resolve, reject){

		try {

			self.brokerUrl = brokerUrl;
			self.ws = ws(brokerUrl);

			self.ws.on("open", function(){

				self.sendRequest(protocol.commands.auth, {
					service: self.serviceName
				}, function(res){

					if(res instanceof Error)
						reject(err);
					else
						resolve(res);

				});

			});

			self.ws.on("close", function(){

				self.close();

			});

			self.ws.on("message", function(msg){

				self.handleSocketMessage(msg);

			});

			self.ws.on("error", function(err){

				self.emit("error", err);

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
 * Publish message
 *
 * @param String channel
 * @param Object message
 * @return Promise
 * @resolve true
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