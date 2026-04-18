# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Hardware

- **Board**: Arduino Nano ESP32 (FQBN `arduino:esp32:nano_nora`). USB CDC — enumerates as `/dev/ttyACM*` on Linux.
- **Display**: 1.3" I²C OLED, FPC-2070003001…03. 1.3" OLEDs use the **SH1106** controller (128×64), not SSD1306. Default I²C address is `0x3C`. On the Nano ESP32, I²C pins are `A4` (SDA) and `A5` (SCL); `Wire.begin()` with no args is correct.
- **Host environment**: WSL2. USB serial is not visible to the VM by default — use `usbipd-win` on Windows to attach the device (`usbipd list`, `usbipd attach --wsl --busid <id>`), then the port appears as `/dev/ttyACM0`.

## Toolchain

Neither `arduino-cli` nor `pio` is installed yet. Pick one before writing code:

- **arduino-cli** (simpler for a single sketch):
  ```
  arduino-cli core install arduino:esp32
  arduino-cli lib install "U8g2"          # SH1106 driver, preferred over Adafruit_SH110X for 1.3" panels
  arduino-cli compile --fqbn arduino:esp32:nano_nora <sketch_dir>
  arduino-cli upload  --fqbn arduino:esp32:nano_nora -p /dev/ttyACM0 <sketch_dir>
  arduino-cli monitor -p /dev/ttyACM0 -c baudrate=115200
  ```
- **PlatformIO**: board id `arduino_nano_esp32`, framework `arduino`, lib `olikraus/U8g2`.

## Display notes (traps to avoid)

- Using an SSD1306 driver against an SH1106 panel produces a shifted image with vertical garbage on the right — if you see that, the controller is wrong, not the wiring.
- Prefer `U8G2_SH1106_128X64_NONAME_F_HW_I2C` (full buffer, hardware I²C). Call `u8g2.begin()` in `setup()`, then `firstPage()`/`nextPage()` or `clearBuffer()`/`sendBuffer()` in `loop()`.
