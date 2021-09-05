# QMK-HID-Display
> This code has been forked and modified, and does not represent the original contributor

A small node script that will collect data and send updates to a qmk enabled keyboard to show on the OLED display.

## Notes
1. Bytes sent to keyboard has to be exactly 32 bytes in length
2. A full line on the 128x32 OLED display is 21 characters/ bytes
3. This script only fetches and sends info 1 time (32 bytes) hence only filling 1.5 lines on the OLED display. To show information on all 4 lines, please visit the author [github](https://github.com/BlankSourceCode/qmk-hid-display) page.

To anyone brave enough to use this - Good Luck!
