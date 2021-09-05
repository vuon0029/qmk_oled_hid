#!/usr/bin/env node
"use strict";

// UPDATE THIS TO FIT YOUR KEYBOARD, INFO CAN BE FOUND IN QMK congif.h FILE
const KEYBOARD_NAME = "Mercutio"; // #define PRODUCT
const KEYBOARD_USAGE_ID = 0x61; // default, dont need to change
const VENDOR_ID = 0x6d77; // #define VENDOR_ID
const PRODUCT_ID = 0x1703; // #define PRODUCT_ID
const KEYBOARD_USAGE_PAGE = 0xff60; // default, dont need to change
const KEYBOARD_UPDATE_TIME = 1000;

const hid = require("node-hid");
const process = require("process");
const os = require("os-utils");
const request = require("request");
const batteryLevel = require("battery-level");
const loudness = require("loudness");
const notifier = require("node-notifier");
const path = require("path");
const weatherURL =
  "https://www.yahoo.com/news/weather/canada/ottawa/ottawa-24017230";

// the node-audio-windows version is much faster on windows, but loudness handles other os's better, so let's get the best of both worlds
let winAudio;
try {
  winAudio = require("node-audio-windows").volume;
} catch (err) {
  // do nothing
}

let kbInterval;
const days = [
  "Sunday",
  "Monday",
  "Tuesday",
  `Wednesday`,
  "Thursday",
  "Friday",
  "Saturday",
];

// Info screen types
const SCREEN_PERF = 2;
const SCREEN_WEATHER = 3;
const screens = ["", "", "", ""];
let currentScreenIndex = 0;

let keyboard = null;
let screenBuffer = null;
let screenLastUpdate = null;

// Helper function to wait a few milliseconds using a promise
function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function startPerfMonitor() {
  while (true) {
    const [
      cpuUsagePercent,
      usedMemoryPercent,
      volumeLevelPercent,
      batteryPercent,
    ] = await Promise.all([
      new Promise((resolve) => os.cpuUsage((usage) => resolve(usage * 100))),
      100 - os.freememPercentage() * 100,
      os.platform() === "darwin" || winAudio === undefined
        ? loudness.getVolume()
        : winAudio.getVolume() * 100,
      (await batteryLevel()) * 100,
    ]);

    const screen = [
      ["C:", cpuUsagePercent],
      ["R:", usedMemoryPercent],
      ["V:", volumeLevelPercent],
      ["B:", batteryPercent],
    ];

    const barGraphSize = 6;

    // Set this to be the latest performance info
    screens[SCREEN_PERF] = screen
      .map(([header, percent]) => {
        const numBlackTiles = barGraphSize * (percent / 100);
        return `${header} ${"\u0008".repeat(
          Math.ceil(numBlackTiles)
        )}${" ".repeat(barGraphSize - numBlackTiles)}| `;
      })
      .join("");

    await wait(KEYBOARD_UPDATE_TIME);
  }
}

async function startWeatherMonitor() {
  // Regex's for reading out the weather info from the yahoo page
  const tempRegex = /"temperature":({[^}]+})/;
  const condRegex = /"conditionDescription":"([^"]+)"/;
  const rainRegex = /"precipitationProbability":([^,]+),/;

  function getWeather() {
    return new Promise((resolve) => {
      request(weatherURL, (err, res, body) => {
        const weather = {};
        const temp = tempRegex.exec(body);
        if (temp && temp.length > 1) {
          weather.temp = JSON.parse(temp[1]);
        }

        const cond = condRegex.exec(body);
        if (cond && cond.length > 1) {
          weather.desc = cond[1];
        }

        const rain = rainRegex.exec(body);
        if (rain && rain.length > 1) {
          weather.rain = rain[1];
        }
        resolve(weather);
      });
    });
  }

  // Used for scrolling long weather descriptions
  let lastWeather = null;
  let lastWeatherDescIndex = 0;

  // Just keep updating the data forever
  while (true) {
    // Get the current weather for Seattle
    const weather = await getWeather();
    if (weather && weather.temp && weather.desc && weather.rain) {
      let description = weather.desc;

      // If we are trying to show the same weather description more than once, and it is longer than 9
      // Which is all that will fit in our space, lets scroll it.
      if (
        lastWeather &&
        weather.desc == lastWeather.desc &&
        weather.desc.length > 9
      ) {
        // Move the string one character over
        lastWeatherDescIndex++;
        description = description.slice(
          lastWeatherDescIndex,
          lastWeatherDescIndex + 9
        );
        if (lastWeatherDescIndex > weather.desc.length - 9) {
          // Restart back at the beginning
          lastWeatherDescIndex = -1; // minus one since we increment before we show
        }
      } else {
        lastWeatherDescIndex = 0;
      }
      lastWeather = weather;

      let date_ob = new Date();

      let date = ("0" + date_ob.getDate()).slice(-2);
      let day = date_ob.getDay();
      let month = ("0" + (date_ob.getMonth() + 1)).slice(-2);
      let year = date_ob.getFullYear();
      let hours = date_ob.getHours();
      let minutes = date_ob.getMinutes();
      const ampm = hours >= 12 ? "pm" : "am";
      hours = hours % 12;
      hours = hours ? hours : 12; // the hour '0' should be '12'
      minutes = minutes < 10 ? "0" + minutes : minutes;
      const timeString = hours + ":" + minutes + ampm;

      const dateString = `${date}/${month}/${year}`;

      const screen =
        `${dateString}${" ".repeat(
          Math.max(0, 9 - ("" + dateString).length)
        )}    ` +
        `${timeString}${" ".repeat(
          Math.max(0, 4 - ("" + timeString).length)
        )}  ${days[day]}       `;

      screens[SCREEN_WEATHER] = screen;
    }

    // Pause a bit before requesting more info
    await wait(KEYBOARD_UPDATE_TIME);
  }
}

async function sendToKeyboard(screen) {
  // If we are already buffering a screen to the keyboard just quit early.
  // Or if there is no update from what we sent last time.
  if (screenBuffer || screenLastUpdate === screen) {
    return;
  }
  console.log("Sending updates... ");

  screenLastUpdate = screen;

  // Convert the screen string into raw bytes
  screenBuffer = [];
  for (let i = 0; i < screen.length; i++) {
    screenBuffer.push(screen.charCodeAt(i));
  }

  // Split the bytes into 4 lines that we will send one at a time
  // This is to prevent hitting the 32 length limit on the connection
  const lines = [];

  lines.push([0].concat(screenBuffer.slice(0, 32)));

  // Loop through and send each line after a small delay to allow the
  // keyboard to store it ready to send to the slave side once full.
  try {
    let index = 0;
    for (const line of lines) {
      if (os.platform() === "darwin") {
        await wait(200);
      }
      const data = await keyboard.write(line);
      console.log("written: ", data);
      if (os.platform() === "darwin") {
        await wait(200);
      } else {
        await wait(100);
      }
    }

    // We have sent the screen data, so clear it ready for the next one
    screenBuffer = null;
  } catch (err) {
    console.log("ERR: ", err);
    notifier.notify(
      {
        title: "Keyboard: Failed to write HID",
        message: "Click to close server!",
        icon: path.join(__dirname, "coulson.jpg"), // Absolute path (doesn't work on balloons)
        sound: true, // Only Notification Center or Windows Toasters
        wait: true, // Wait with callback, until user action is taken against notification, does not apply to Windows Toasters as they always wait or notify-send as it does not support the wait option
      },
      function (err, response, metadata) {
        // Response is response from notification
        // Metadata contains activationType, activationAt, deliveredAt
      }
    );

    notifier.on("click", function (notifierObject, options, event) {
      // Triggers if `wait: true` and user clicks notification

      console.log("close");
      keyboard.close();
      clearInterval(kbInterval);
      kbInterval = 0;
      process.exit(1);
    });

    notifier.on("timeout", function (notifierObject, options) {
      // Triggers if `wait: true` and notification closes
      console.log("close");
      keyboard.close();
      clearInterval(kbInterval);
      kbInterval = 0;
      process.exit(1);
    });
  }
}

async function updateKeyboardScreen() {
  // If we don't have a connection to a keyboard yet, look now
  if (!keyboard) {
    const devices = hid.devices();
    for (const d of devices) {
      if (
        d.product === KEYBOARD_NAME &&
        d.usage === KEYBOARD_USAGE_ID &&
        d.usagePage === KEYBOARD_USAGE_PAGE &&
        d.vendorId === VENDOR_ID &&
        d.productId === PRODUCT_ID
      ) {
        keyboard = new hid.HID(d.path);
        console.log(`Keyboard connection established.`);

        keyboard.on("data", (e) => {
          // console.log(e);
          // Check that the data is a valid screen index and update the current one
          if (e[0] >= 1 && e[0] <= screens.length) {
            currentScreenIndex = e[0] - 1;
            console.log(
              `Keyboard requested screen index: ${currentScreenIndex}`
            );
          }
        });

        // On the initial connection write our special sequence
        // 1st byte - unused and thrown away on windows see bug in node-hid
        // 2nd byte - 1 to indicate a new connection
        // 3rd byte - number of screens the keyboard can scroll through
        // let initialBuffer = [];
        // for (let i = 0; i < initialByte.length; i++) {
        //   initialBuffer.push(initialByte.charAt(i));
        // }

        const initialBytes = [
          0x00,
          1,
          screens.length,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
        ];

        keyboard.write(initialBytes);

        break;
      }
    }
  }

  // If we have a connection to a keyboard and a valid screen
  if (keyboard && screens[currentScreenIndex].length > 0) {
    // Send that data to the keyboard
    sendToKeyboard(screens[currentScreenIndex]);
  }
}

// Start the monitors that collect the info to display in the background
startPerfMonitor();
startWeatherMonitor();

// Update the data on the keyboard with the current info screen every second
kbInterval = setInterval(updateKeyboardScreen, KEYBOARD_UPDATE_TIME);
