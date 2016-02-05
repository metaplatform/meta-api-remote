# meta-api-remote

META API Remote client library

## Warning
Unstable development version. Package `meta-api-shared` must be installed manually or linked.

## TO-DO
Tests, tests and tests.

## Usage
```javascript
var RemoteApi = require("meta-api-remote");

var client = new RemoteApi.Client("service-name", { /* credentials */ });

client.connect(brokerUrl).then(function(){
	
	//...

});
```

## Client interface
```javascript
/*
 * Creates connection to broker
 *
 * @param Broker broker
 * @return Promise
 * @resolve true
 */
Client.prototype.connect = function(brokerUrl);

/*
 * Closes connection - removes all subscriptions
 *
 * @return Promise
 * @resolve true
 */
Client.prototype.close();

/*
 * Add property to root endpoint
 *
 * @param String name
 * @param Function handler
 * @return Endpoint
 */
Client.prototype.endpoint = function(name, handler);

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
Client.prototype.call = function(service, endpoint, method, params);

/*
 * Subscribe to channel
 *
 * @param String channel
 * @param Function cb
 * @return Promise
 * @resolve Object Subscription handler with remove() method
 */
Client.prototype.subscribe = function(channel, cb);

/*
 * Unsubscribes from channel
 *
 * @param String channel
 * @param Function cb
 * @return Promise
 * @resolve Bool true if was subscribed
 */
Client.prototype.unsubscribe = function(channel, cb);

/*
 * Publish message
 *
 * @param String channel
 * @param Object message
 * @return Promise
 * @resolve Integer subscribers count
 */
Client.prototype.publish = function(channel, message);

/*
 * Subscribes to queue messages
 *
 * @param String queue
 * @param Function cb
 * @return Promise
 * @resolve Object Subscription handler with remove() method
 */
Client.prototype.subscribeQueue = function(queue, cb);

/*
 * Unsubscribes from queue messages
 *
 * @param String queue
 * @param Function cb
 * @return Promise
 * @resolve Bool true if was subscribed
 */
Client.prototype.unsubscribeQueue = function(queue);

/*
 * Enqueue message
 *
 * @param String queue
 * @param Object message
 * @return Promise
 * @resolve true
 */
Client.prototype.enqueue = function(queue, message);
```

## Testing
```
npm install --dev
npm test
```

## License
Not yet defined - assume Free for non-commercial use