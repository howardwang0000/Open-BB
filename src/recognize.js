/*
 * Handwriting recognition via Google Input Tools.
 *
 * The device sends the strokes the user drew (as ink coordinates) and gets
 * back a ranked list of candidate Chinese characters. This is the same
 * service used by many handwriting keyboards.
 *
 * strokes: array of { xs: number[], ys: number[] } — one entry per stroke.
 */
const ENDPOINT =
  "https://inputtools.google.com/request?ime=handwriting&app=mobile&dbg=1&cs=1&oe=UTF-8";

export async function recognize(strokes, width, height) {
  const ink = strokes
    .filter((s) => s.xs.length > 0)
    .map((s) => [s.xs, s.ys]);

  if (ink.length === 0) return [];

  const body = {
    options: "enable_pre_space",
    requests: [
      {
        writing_guide: {
          writing_area_width: width,
          writing_area_height: height,
        },
        ink,
        language: "zh",
      },
    ],
  };

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error("Recognition service error (" + res.status + ")");
  }

  const data = await res.json();
  // Expected shape: ["SUCCESS", [ [ "<id>", ["中","忠",...], ... ] ] ]
  if (!Array.isArray(data) || data[0] !== "SUCCESS") {
    throw new Error("Could not read your handwriting. Try writing more clearly.");
  }

  try {
    const candidates = data[1][0][1];
    return Array.isArray(candidates) ? candidates : [];
  } catch (e) {
    return [];
  }
}
