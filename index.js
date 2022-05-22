import { Network, OpenSeaStreamClient } from "@opensea/stream-js";
import fetch from 'node-fetch';
import { WebSocket } from "ws";

// inputs
const OS_API_KEY = process.env.OS_API_KEY
if (OS_API_KEY == undefined) {
    console.log("Please define OS_API_KEY environment variable")
    process.exit(1)
}
const COLLECTION_SLUG = process.argv[2];
if (COLLECTION_SLUG == undefined) {
    console.log("Usage: node index.js <collection-slug>")
    process.exit(1)
}

let STREAM_RESULTS = []
let API_RESULTS = []
let BOTH_RESULTS = []
let occurredAfter = null

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

function getEpochTimestamp(timestamp) {
    // use a timestamp if it is given, else use the current time
    let date = (timestamp) ? new Date(timestamp) : new Date()
    return Math.floor(date.getTime() / 1000)
}

// part 1: opensea stream-js client
const client = new OpenSeaStreamClient({
    network: Network.MAINNET,
    token: OS_API_KEY,
    onError: (x) => console.log(x),
    connectOptions: {
      transport: WebSocket,
    },
  });

client.onItemListed(COLLECTION_SLUG, async (event) => {
    if (occurredAfter == null) {
        occurredAfter = getEpochTimestamp(event.payload.event_timestamp) - 5;
        startPolling()
    }

    STREAM_RESULTS.push({
        event_timestamp: event.payload.event_timestamp.split("+")[0],
        permalink: event.payload.item.permalink,
    })
});

// part 2: events api polling
async function get_listings(occurredAfter) {
    const options = {
        method: 'GET',
        headers: {
            'Accept': 'application/json',
            'X-API-KEY': OS_API_KEY
        }
    };

    let nextPage = null
    do {
        try {
            await sleep(250) // 4 req / s max
            let url = `https://api.opensea.io/api/v1/events?collection_slug=${COLLECTION_SLUG}&event_type=created&occurred_after=${occurredAfter}`
            if (nextPage != null) {
                url += '&cursor=' + nextPage
            }
            let response = await fetch(url, options).then((r) => r.json())
            response.asset_events.forEach((event) => {
                // check for existing results that match the event_timestamp
                let match = API_RESULTS.find((existing) => existing.event_timestamp == event.event_timestamp)
                if (match != undefined) {
                    return
                }
                // check previously removed results as well
                match = BOTH_RESULTS.find((existing) => existing.event_timestamp == event.event_timestamp)
                if (match != undefined) {
                    return
                }
                API_RESULTS.push({
                    event_timestamp: event.event_timestamp,
                    permalink: event.asset.permalink,
                })
            })
            nextPage = response.next
        } catch (err) {
            console.log("API error:", err)
            break
        }
    } while (nextPage != null)
    return
}

function startPolling() {
    let after = null
    setInterval(async () => {
        await get_listings(occurredAfter)
        // keep a 60 second REST API window open for events to show up (when stream api leads rest api)
        // note this window doesnt make any difference for when events are not showing up in the stream api
        occurredAfter = Math.max(getEpochTimestamp() - 60, occurredAfter)
        compareResults()
    }, 5000)
}

function* reverseKeys(arr) {
    // indexes an array in reverse
    // eg if there are 5 items in array, returns 4,3,2,1,0
    var key = arr.length - 1;
    while (key >= 0) {
      yield key;
      key -= 1;
    }
  }

function compareResults() {
    // removal of matching results between api and websocket
    for (var sidx of reverseKeys(STREAM_RESULTS)) {
        for (var aidx of reverseKeys(API_RESULTS)) {
            if (STREAM_RESULTS[sidx].event_timestamp == API_RESULTS[aidx].event_timestamp) {
                console.log("MATCH BOTH", STREAM_RESULTS[sidx])
                BOTH_RESULTS.push(STREAM_RESULTS[sidx])
                STREAM_RESULTS.splice(sidx, 1);
                API_RESULTS.splice(aidx, 1);
                break
            }
        }
    }
    console.log(new Date(), STREAM_RESULTS.length, "stream only", API_RESULTS.length, "api only", BOTH_RESULTS.length, "both")
    // // Uncomment for more info
    console.log("STREAM MISSING FROM API")
    STREAM_RESULTS.forEach((x) => console.log(" ", x.event_timestamp, " ", x.permalink))
    console.log("API MISSING FROM STREAM")
    API_RESULTS.forEach((x) => console.log(" ", x.event_timestamp, " ", x.permalink))
    console.log("API AND STREAM")
    BOTH_RESULTS.forEach((x) => console.log(" ", x.event_timestamp, " ", x.permalink))
    console.log("---------")
}