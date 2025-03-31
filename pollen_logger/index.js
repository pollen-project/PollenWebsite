const mqtt = require("mqtt");
const { MongoClient } = require('mongodb');
const express = require('express')
const cors = require('cors')

const app = express()
const port = 3000

const brokerURL = "mqtts://mqtt.eclipseprojects.io";
const topic = "/pollen";
let mqttClient;

const mongoURL = process.env.MONGO_URL
const mongoClient = new MongoClient(mongoURL);
let history;
let devices;

async function on_connect() {
    console.log("Connected to MQTT broker");

    mqttClient.subscribe(topic, (err) => {
        if (err) {
            console.error("Failed to subscribe to topic:", err);
        } else {
            console.log(`Subscribed to topic: ${topic}`);
        }
    });
}

async function on_message(topic, message) {
    try {
        const data = JSON.parse(message.toString())
        data["timestamp"] = new Date()

        const device = await devices.findOne({name: "Test box"}) ?? {}

        if ("dht22" in data && Array.isArray(data.dht22)) {
            data.dht22 = data.dht22.map(v => v.rh > 100 ? ({t: null, rh: null}) : v)
            device.dht22 = data.dht22.map((v, i) => !v.rh && device.dht22?.length > i ? device.dht22[i] : v)
        }

        if ("power" in data) {
            device.power = data.power
        }

        if ("gps" in data) {
            device.gps = data.gps
        }

        await devices.updateOne(
            {
                name: "Test box"
            },
            {
                "$set": {
                    name: "Test box",
                    ...device
                }
            },
            {
                upsert: true
            })
        await history.insertOne(data);
    }
    catch (e) {}
}

(async () => {
    await mongoClient.connect()
    const db = mongoClient.db("pollen")
    devices = db.collection('devices')
    history = db.collection('monitoring')

    mqttClient = mqtt.connect(brokerURL)
    mqttClient.on('connect', on_connect)
    mqttClient.on('message', on_message)
})()

app.use(cors())

app.get('/api/devices', async (req, res) => {
    res.json(await devices.find()
        .toArray())
})

app.get('/api/history', async (req, res) => {
    const filters = {}

    if ("from" in req.query && "until" in req.query) {
        filters.timestamp = {
            $gte: new Date(req.query.from),
            $lt: new Date(req.query.until)
        }
    }

    res.json(await history.find(filters)
        .sort({timestamp: -1})
        .limit(100)
        .toArray())
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})
