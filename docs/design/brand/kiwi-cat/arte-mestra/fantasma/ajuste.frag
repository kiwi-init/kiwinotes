#version 300 es
precision highp float;
uniform sampler2D uSdf;       // R: the v2 core's signed distance (canvas units, negative inside); G: the same, blurred
uniform float uTime, uLight;
uniform vec2 uRes;
uniform vec4 uEye0, uEye1;    // cx, cy, r (canvas units)
// the parameters, by the names the module's shader will use
uniform float auraAmount, auraRadius, edgeSoftness, auraFloor;
uniform vec3 mistColor;
uniform float arcIntensity, arcWidth, arcFrom, arcTo;
uniform vec3 arcCyan, arcBlue, arcViolet, arcPink;
uniform float breathOn, breathType, breathPeriod, breathAmount;
uniform float floatOn, floatHeight, floatPeriod;
uniform float wispAmount, wispSpeed;
out vec4 outColor;

const float TAU = 6.28318530718;
const float FLOAT_TAIL_LAG = 0.3;    // the tail's delay in the float (radians)

float hash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
float noise(vec3 p) {
  vec3 i = floor(p), f = fract(p); vec3 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec3(1,0,0)), c = hash(i + vec3(0,1,0)), d = hash(i + vec3(1,1,0));
  float e = hash(i + vec3(0,0,1)), g = hash(i + vec3(1,0,1)), h = hash(i + vec3(0,1,1)), k = hash(i + vec3(1,1,1));
  return mix(mix(mix(a,b,u.x), mix(c,d,u.x), u.y), mix(mix(e,g,u.x), mix(h,k,u.x), u.y), u.z);
}
float fbm2(vec3 p) { return 0.62 * noise(p) + 0.38 * noise(p * 2.03 + vec3(11.7, 3.1, 7.9)); }
float sdf(vec2 q) { return texture(uSdf, q / vec2(2048.0, 2560.0)).r; }
float sdfSoft(vec2 q) { return texture(uSdf, q / vec2(2048.0, 2560.0)).g; }

float bob(float y, float t) {
  float lift = floatOn * floatHeight / 120.0 * 2560.0;          // px at 120 -> canvas units
  float lag = FLOAT_TAIL_LAG * smoothstep(1300.0, 2200.0, y);
  return lift * sin(TAU * t / max(floatPeriod, 0.1) - lag);
}
float breathing(float y, float t) {
  float ph = TAU * t / max(breathPeriod, 0.1), b;
  if (breathType < 0.5) b = sin(ph);                                        // respirar: a slow sine
  else if (breathType < 1.5) b = 2.0 * pow(0.5 + 0.5 * sin(ph), 4.0) - 1.0;  // pulsar: a short beat, a long rest
  else b = sin(ph + y * 0.004);                                             // ondular: a wave rising through the halo
  return 1.0 + breathOn * breathAmount * b;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uRes * vec2(2048.0, 2560.0);
  float t = uTime;
  vec2 q = p - vec2(0.0, bob(p.y, t));
  float low = smoothstep(1500.0, 2150.0, q.y);                 // 0 at the head, 1 at the tail
  float n1 = fbm2(vec3(q * 0.0035, t * 0.10));
  float tw = t * wispSpeed;
  vec2 w = vec2(q.x + 70.0 * sin(q.y * 0.0035 + tw * 0.55), q.y);
  float n2 = fbm2(vec3(w.x * 0.0030, w.y * 0.0020 - tw * 0.14, tw * 0.05));
  float d0 = sdf(q) + (n1 - 0.5) * mix(14.0, 80.0, low);
  // wisps: only the core's lower edge frays; the halo keeps the whole shape
  float d = d0 + wispAmount * (20.0 + 140.0 * smoothstep(0.30, 0.80, n2)) * smoothstep(1750.0, 2150.0, q.y);
  // the core: dense black, soft all the way round, softer toward the tail
  float soft = edgeSoftness * mix(1.0, 3.4, low);
  float core = 1.0 - smoothstep(-soft, soft, d);
  // the halo: a short glow from inside the edge, the wide ring of v2 (stronger below) and a floor near the core
  float ds = sdfSoft(q) + (n1 - 0.5) * mix(14.0, 80.0, low);
  float glow = 0.45 * exp(-max(d0 + 20.0, 0.0) / (auraRadius * 0.7));
  float ring = exp(-pow((ds - auraRadius) / (auraRadius * 1.15), 2.0)) * (0.16 + 0.74 * smoothstep(1350.0, 2150.0, q.y));
  float floorD = auraFloor * 0.88 * exp(-max(ds, 0.0) / (auraRadius * 2.0)) * (1.0 - smoothstep(auraRadius * 1.3, auraRadius * 3.0, ds));
  float halo = auraAmount * max(glow + 0.85 * ring, floorD) * breathing(q.y, t) * (0.92 + 0.16 * (n1 - 0.5));
  halo *= smoothstep(0.0, 340.0, min(min(p.x, 2048.0 - p.x), min(p.y, 2560.0 - p.y)));   // zero at the box's edge
  float haloA = clamp(halo, 0.0, 1.0);
  // the colour: an arc inside the head along the skull (the halo changing hue there)
  vec2 r0 = q - vec2(1104.0, 1304.0);
  float rad = length(r0), th = degrees(atan(r0.y, r0.x)); th = th < 0.0 ? th : th - 360.0;
  float along = smoothstep(arcTo, arcTo - 42.0, th) * (1.0 - smoothstep(arcFrom + 18.0, arcFrom, th));
  float across = (rad - 405.0) / max(arcWidth, 1.0);           // + outer .. - inner
  float band = exp(-0.5 * across * across) * along * (0.92 + 0.16 * (n1 - 0.5));
  float inside = 1.0 - smoothstep(-30.0, 70.0, d0);
  float k = clamp(across * 0.5 + 0.5, 0.0, 1.0);               // 0 inner .. 1 outer
  float lowEnd = smoothstep(arcFrom + 56.0, arcFrom + 6.0, th);  // toward the cheek it turns pink
  vec3 prism = k > 0.5 ? mix(arcBlue, arcCyan, (k - 0.5) * 2.0) : mix(mix(arcViolet, arcPink, lowEnd), arcBlue, k * 2.0);
  float arcA = clamp(band * inside * arcIntensity, 0.0, 1.0);
  vec3 coreCol = vec3(0.035, 0.035, 0.045);
  float blueW = 0.75 * exp(-dot(q - vec2(1500.0, 1170.0), q - vec2(1500.0, 1170.0)) / (2.0 * 150.0 * 150.0));
  vec3 haloCol = mix(mistColor, arcCyan * 0.6 + arcBlue * 0.4, blueW);   // the touch of blue on the right
  if (uLight > 0.5) {
    // the inverse: a light core and a soft dark halo, the same silhouette; the arc in deeper tones
    coreCol = vec3(0.975, 0.975, 0.985);
    haloCol = haloCol * 0.42;
    haloA *= 0.50;
    prism *= 0.62;
    arcA *= 0.8;
  }
  float eyes = 0.0;
  for (int i = 0; i < 2; i++) {
    vec4 E = i == 0 ? uEye0 : uEye1;
    vec2 c = vec2(E.x, E.y + bob(E.y, t));
    eyes = max(eyes, 1.0 - smoothstep(E.z - 1.6, E.z + 1.6, length(p - c)));
  }
  vec3 eyeCol = uLight > 0.5 ? vec3(0.09, 0.09, 0.11) : vec3(1.0);
  // straight-alpha layers, premultiplied at the end
  float a = core + haloA * (1.0 - core);
  vec3 col = (coreCol * core + haloCol * haloA * (1.0 - core)) / max(a, 1e-4);
  float a2 = arcA + a * (1.0 - arcA);
  col = (prism * arcA + col * a * (1.0 - arcA)) / max(a2, 1e-4); a = a2;
  vec3 rgb = col * a;
  rgb = mix(rgb, eyeCol, eyes); a = max(a, eyes);
  outColor = vec4(rgb, a);
}
