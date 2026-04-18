#include <Arduino.h>
#include <U8g2lib.h>
#include <Wire.h>

U8G2_SH1106_128X64_NONAME_F_HW_I2C display(U8G2_R0, U8X8_PIN_NONE);

enum Emotion { NEUTRAL, HAPPY, SAD, ANGRY, SURPRISED };
enum Arms    { ARMS_OPEN, ARMS_CROSSED };

Emotion currentEmotion = NEUTRAL;
Arms    currentArms    = ARMS_OPEN;

static const int HEAD_CX = 64;
static const int HEAD_CY = 18;
static const int HEAD_R  = 14;

static void drawHead() {
  display.drawCircle(HEAD_CX, HEAD_CY, HEAD_R);
}

static void drawEye(int cx, int cy) {
  display.drawBox(cx - 1, cy - 1, 3, 3);
}

static void drawEyesNormal() {
  drawEye(HEAD_CX - 5, HEAD_CY - 3);
  drawEye(HEAD_CX + 5, HEAD_CY - 3);
}

static void drawEyesWide() {
  display.drawCircle(HEAD_CX - 5, HEAD_CY - 3, 3);
  display.drawPixel(HEAD_CX - 5, HEAD_CY - 3);
  display.drawCircle(HEAD_CX + 5, HEAD_CY - 3, 3);
  display.drawPixel(HEAD_CX + 5, HEAD_CY - 3);
}

static void drawAngryBrows() {
  display.drawLine(HEAD_CX - 9, HEAD_CY - 8, HEAD_CX - 2, HEAD_CY - 5);
  display.drawLine(HEAD_CX + 2, HEAD_CY - 5, HEAD_CX + 9, HEAD_CY - 8);
}

static void drawSadBrows() {
  display.drawLine(HEAD_CX - 9, HEAD_CY - 5, HEAD_CX - 2, HEAD_CY - 8);
  display.drawLine(HEAD_CX + 2, HEAD_CY - 8, HEAD_CX + 9, HEAD_CY - 5);
}

static void drawMouthSmile() {
  for (int x = -6; x <= 6; x++) {
    float t = x / 6.0f;
    int dy = (int)(4.0f * (1.0f - t * t));
    display.drawPixel(HEAD_CX + x, HEAD_CY + 3 + dy);
  }
}

static void drawMouthFrown() {
  for (int x = -6; x <= 6; x++) {
    float t = x / 6.0f;
    int dy = (int)(4.0f * (1.0f - t * t));
    display.drawPixel(HEAD_CX + x, HEAD_CY + 8 - dy);
  }
}

static void drawMouthFlat() {
  display.drawBox(HEAD_CX - 4, HEAD_CY + 6, 9, 1);
}

static void drawMouthO() {
  display.drawCircle(HEAD_CX, HEAD_CY + 6, 2);
}

static void drawTorso() {
  display.drawLine(50, 34, 54, 60);
  display.drawLine(78, 34, 74, 60);
  display.drawLine(54, 60, 74, 60);
}

static void drawArmsOpen() {
  // down the sides
  display.drawLine(50, 34, 46, 48);
  display.drawLine(46, 48, 46, 60);
  display.drawLine(51, 34, 47, 48);
  display.drawLine(47, 48, 47, 60);
  display.drawLine(78, 34, 82, 48);
  display.drawLine(82, 48, 82, 60);
  display.drawLine(77, 34, 81, 48);
  display.drawLine(81, 48, 81, 60);
}

static void drawArmsCrossed() {
  // two forearms forming X across torso (2px thick)
  display.drawLine(50, 36, 76, 50);
  display.drawLine(51, 36, 77, 50);
  display.drawLine(78, 36, 52, 50);
  display.drawLine(77, 36, 51, 50);
}

static void renderFace() {
  display.clearBuffer();
  drawHead();

  switch (currentEmotion) {
    case HAPPY:
      drawEyesNormal();
      drawMouthSmile();
      break;
    case SAD:
      drawSadBrows();
      drawEyesNormal();
      drawMouthFrown();
      break;
    case ANGRY:
      drawAngryBrows();
      drawEyesNormal();
      drawMouthFlat();
      break;
    case SURPRISED:
      drawEyesWide();
      drawMouthO();
      break;
    case NEUTRAL:
    default:
      drawEyesNormal();
      drawMouthFlat();
      break;
  }

  drawTorso();
  if (currentArms == ARMS_CROSSED) drawArmsCrossed();
  else                              drawArmsOpen();

  display.sendBuffer();
}

static Emotion parseEmotion(const String& t) {
  if (t == "happy") return HAPPY;
  if (t == "sad") return SAD;
  if (t == "angry") return ANGRY;
  if (t == "surprised") return SURPRISED;
  return NEUTRAL;
}

static Arms parseArms(const String& t) {
  if (t == "crossed") return ARMS_CROSSED;
  return ARMS_OPEN;
}

// Accepts "emotion" or "emotion,arms"
static void handleLine(String line) {
  line.trim();
  line.toLowerCase();
  if (line.length() == 0) return;

  String em, ar;
  int comma = line.indexOf(',');
  if (comma < 0) {
    em = line;
    ar = "open";
  } else {
    em = line.substring(0, comma);
    ar = line.substring(comma + 1);
    em.trim();
    ar.trim();
  }

  Emotion ne = parseEmotion(em);
  Arms    na = parseArms(ar);
  if (ne != currentEmotion || na != currentArms) {
    currentEmotion = ne;
    currentArms = na;
    renderFace();
  }
  Serial.print("ok ");
  Serial.print(em);
  Serial.print(",");
  Serial.println(ar);
}

void setup() {
  Serial.begin(115200);
  Wire.setPins(D3, D2);
  display.begin();
  display.setBusClock(400000);
  renderFace();
}

void loop() {
  if (Serial.available()) {
    String line = Serial.readStringUntil('\n');
    handleLine(line);
  }
}
