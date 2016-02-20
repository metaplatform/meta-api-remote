/*
 * META API
 *
 * @author META Platform <www.meta-platform.com>
 * @license See LICENSE file distributed with this source code
 */

var Client = require("meta-api-shared").Client;
var Connection = require("./connection.js");

/*
 * Remote API client
 *
 * Create WebSocket API client
 *
 * @param String serviceName
 */
var RemoteClient = function(serviceName){

	Client.call(this, serviceName);

};

RemoteClient.prototype = Object.create(Client.prototype);

/*
 * Connects to remote broker
 *
 * @param String brokerUrl
 * @return Promise
 * @resolve true
 */
RemoteClient.prototype.connect = function(brokerUrl, secret){

	var self = this;

	return new Promise(function(resolve, reject){

		try {

			if(self.connection)
				return reject(new Error("API client already connected."));
		
			self.connection = new Connection(self.serviceName, function(endpoint, method, params){

				return self.handleCall(endpoint, method, params);

			}, function(channel, message){

				return self.handleMessage(channel, message);

			}, function(queue, message){

				return self.handleQueueMessage(queue, message);

			});

			self.connection.connect(brokerUrl, secret).then(resolve, reject);

		} catch(e){
			reject(e);
		}

	});

};

/*
 * Closes socket connection to broker - removes all subscriptions
 *
 * @return Promise
 * @resolve true
 */
RemoteClient.prototype.close = function(){

	var self = this;

	return new Promise(function(resolve, reject){

		try {

			if(!self.connection)
				return reject(new Error("API client not connected."));
		
			self.connection.close();
			self.subscriptions = {};
			self.queueSubscriptions = {};

			resolve(true);

		} catch(e){
			reject(e);
		}

	});

};

//EXPORT
module.exports = RemoteClient;