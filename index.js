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
let firstTime = null

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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
    if (firstTime == null) {
        firstTime = Math.floor(new Date(event.payload.event_timestamp).getTime() / 1000) - 10;
        startPolling()
    }

    STREAM_RESULTS.push({
        event_timestamp: event.payload.event_timestamp.split("+")[0],
        permalink: event.payload.item.permalink,
    })
});

// part 2: events api polling
async function get_listings(after) {
    const options = {
        method: 'GET',
        headers: {
            'Accept': 'application/json',
            'X-API-KEY': OS_API_KEY
        }
    };

    while (true) {
        try {
            await sleep(250) // 4 req / s max
            let url = `https://api.opensea.io/api/v1/events?collection_slug=${COLLECTION_SLUG}&event_type=created&occurred_after=${firstTime}`
            if (after != null) {
                url += '&cursor=' + after
            }
            let response = await fetch(url, options).then((r) => r.json())
            response.asset_events.forEach((event) => {
                // check that existing results do not match order id
                let match = API_RESULTS.find((existing) => existing.event_timestamp == event.event_timestamp)
                if (match != undefined) {
                    return
                }
                API_RESULTS.push({
                    event_timestamp: event.event_timestamp,
                    permalink: event.asset.permalink,
                })
            })
            if (response.after == null) {
                break
            } else {
                after = response.after
            }
        } catch (err) {
            console.log("API error:", err)
            break
        }
    }
    return after
}

function startPolling() {
    let after = null
    setInterval(async () => {
        after = await get_listings(after)
        compareResults()
    }, 5000)

    setInterval(() => {
    }, 5000)
}

function* reverseKeys(arr) {
    var key = arr.length - 1;
    while (key >= 0) {
      yield key;
      key -= 1;
    }
  }

let bothRunningCount = 0
function compareResults() {
    // removal of matching results between api and websocket
    for (var sidx of reverseKeys(STREAM_RESULTS)) {
        for (var aidx of reverseKeys(API_RESULTS)) {
            if (STREAM_RESULTS[sidx].event_timestamp == API_RESULTS[aidx].event_timestamp) {
                console.log("MATCH BOTH", STREAM_RESULTS[sidx])
                STREAM_RESULTS.splice(sidx, 1);
                API_RESULTS.splice(aidx, 1);
                bothRunningCount += 1
                break
            }
        }
    }
    console.log(new Date(), STREAM_RESULTS.length, "stream only", API_RESULTS.length, "api only", bothRunningCount, "both")
    // // Uncomment for more info
    // console.log("STREAM MISSING FROM API", STREAM_RESULTS)
    // console.log("API MISSING FROM STREAM", API_RESULTS)
    // console.log("---------")
}