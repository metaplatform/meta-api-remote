/*
 * META API
 *
 * @author META Platform <www.meta-platform.com>
 * @license See LICENSE file distributed with this source code
 */

var repl = require("repl");
var Api = require("./index.js");
var Shared = require("meta-api-shared");

if(!process.argv[2]){
	console.error("API url must be specified as first argument.");
	process.exit();
}

if(!process.argv[3]){
	console.error("API secret must be specified as second argument.");
	process.exit();
}

var client = new Api.Client(process.argv[3]);

client.connect(process.argv[2], process.argv[4]).then(function(){

	console.log("Connected.");

	var replServer = repl.start({
		prompt: "meta-api> "
	});

	replServer.on("exit", function(){
		client.close();
	});

	var cbId = 0;
	var refId = 0;

	var reply = function(p){

		p.then(function(res){
			
			console.log("\nReply:");
			console.dir(res, { colors: true, depth: null });

			if(res instanceof Shared.Types.ChannelReference)
				replServer.context.api.subscribe(res.toString());

			console.log("Done.");

		}, function(err){
			console.error(err);
		});

	};

	var createCallback = function(cb){
		cbId++;
		replServer.context["cb" + cbId] = cb;
		return {
			handler: replServer.context["cb" + cbId],
			id: "cb" + cbId
		};
	};

	var createRef = function(ref){
		refId++;
		replServer.context["ref" + refId] = ref;
		return "ref" + refId;
	};

	var makeObj = function(obj){
		if(obj)
			return JSON.parse(JSON.stringify(obj));
		else
			return obj;
	};

	replServer.context.api = {
		
		call: function(service, endpoint, method, params){
			reply(client.call(service, endpoint, method, makeObj(params)));
		},

		subscribe: function(channel){

			var cb = createCallback(function(message){
				console.log("MESSAGE from channel {%s}", channel);
				console.dir(message, { colors: true, depth: null });
			});

			client.subscribe(channel, cb.handler).then(function(ref){
				console.log("Subscription ref: %s", createRef(ref));
			}, function(err){
				console.error(err);
			});

			return cb.id;

		},

		unsubscribe: function(channel, cb){

			client.unsubscribe(channel, cb).then(function(){
				console.log("Unsubscribe successfull.");
			}, function(err){
				console.error("Unsubscribe failed:", err);
			});

		},

		publish: function(channel, message){
			reply(client.publish(channel, makeObj(message)));
		},

		subscribers: function(channel){
			reply(client.subscribers(channel));
		},

		subscribeQueue: function(queue){

			var cb = createCallback(function(message){

				return new Promise(function(resolve, reject){

					console.log("QUEUE MESSAGE from queue {%s}", queue);
					console.dir(message, { colors: true, depth: null });

					resolve(false);

				});

			});

			client.subscribeQueue(queue, cb.handler).then(function(ref){
				console.log("Queue subscription ref: %s", createRef(ref));
			}, function(err){
				console.error(err);
			});

			return cb.id;

		},

		unsubscribeQueue: function(queue){

			client.unsubscribeQueue(queue).then(function(){
				console.log("Queue unsubscribe successfull.");
			}, function(err){
				console.error("Queue unsubscribe failed:", err);
			});

		},

		enqueue: function(queue, message){
			reply(client.enqueue(queue, makeObj(message)));
		},

		close: function(){
			client.close().then(function(){
				//OK
			}, function(err){
				console.error(err);
			});
		}

	};

}, function(err){
	console.error("Error connecting to API:", err);
});

client.connection.on("connectionError", function(err){
	console.error("Connection error:", err);
});

client.connection.on("reconnect", function(err){
	console.error("Reconnecting:", err);
});

client.connection.on("close", function(err){
	console.log("Connection closed.");
	process.exit();
});