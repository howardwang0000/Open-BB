import React, { useRef, useState } from "react";
import { View, StyleSheet, PanResponder } from "react-native";
import Svg, { Path, Line, Rect } from "react-native-svg";

// Convert one stroke ({ xs, ys }) into an SVG path string.
function strokeToPath(stroke) {
  const { xs, ys } = stroke;
  if (!xs.length) return "";
  let d = `M ${xs[0]} ${ys[0]}`;
  for (let i = 1; i < xs.length; i++) {
    d += ` L ${xs[i]} ${ys[i]}`;
  }
  // A single tap (one point) still needs to draw a dot.
  if (xs.length === 1) d += ` L ${xs[0] + 0.1} ${ys[0] + 0.1}`;
  return d;
}

/*
 * A square drawing pad. Fully controlled by the parent:
 *   strokes     — committed strokes, an array of { xs, ys }
 *   onChange    — called with the new strokes array whenever it changes
 *   size        — width/height of the square pad in px
 */
export default function HandwritingCanvas({ strokes, onChange, size }) {
  // The stroke currently being drawn (before finger lifts).
  const currentRef = useRef(null);
  const [, forceRender] = useState(0);
  const tick = () => forceRender((n) => n + 1);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const { locationX, locationY } = e.nativeEvent;
        currentRef.current = { xs: [locationX], ys: [locationY] };
        tick();
      },
      onPanResponderMove: (e) => {
        const { locationX, locationY } = e.nativeEvent;
        if (currentRef.current) {
          currentRef.current.xs.push(locationX);
          currentRef.current.ys.push(locationY);
          tick();
        }
      },
      onPanResponderRelease: () => {
        if (currentRef.current) {
          const finished = currentRef.current;
          currentRef.current = null;
          onChangeRef.current([...strokesRef.current, finished]);
        }
      },
      onPanResponderTerminate: () => {
        currentRef.current = null;
        tick();
      },
    })
  ).current;

  // Keep the latest strokes/onChange reachable from the (stable) PanResponder.
  const strokesRef = useRef(strokes);
  const onChangeRef = useRef(onChange);
  strokesRef.current = strokes;
  onChangeRef.current = onChange;

  const guide = "#2a2f55";

  return (
    <View
      style={[styles.pad, { width: size, height: size }]}
      {...panResponder.panHandlers}
    >
      <Svg width={size} height={size}>
        {/* writing guides: border + center cross + diagonals (米字格) */}
        <Rect
          x={1}
          y={1}
          width={size - 2}
          height={size - 2}
          rx={14}
          fill="#0e1122"
          stroke={guide}
          strokeWidth={2}
        />
        <Line x1={size / 2} y1={0} x2={size / 2} y2={size} stroke={guide} strokeDasharray="6 8" />
        <Line x1={0} y1={size / 2} x2={size} y2={size / 2} stroke={guide} strokeDasharray="6 8" />
        <Line x1={0} y1={0} x2={size} y2={size} stroke={guide} strokeDasharray="4 10" />
        <Line x1={size} y1={0} x2={0} y2={size} stroke={guide} strokeDasharray="4 10" />

        {/* committed strokes */}
        {strokes.map((s, i) => (
          <Path
            key={i}
            d={strokeToPath(s)}
            stroke="#f4f5fb"
            strokeWidth={7}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        ))}

        {/* the stroke in progress */}
        {currentRef.current && (
          <Path
            d={strokeToPath(currentRef.current)}
            stroke="#ffb703"
            strokeWidth={7}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        )}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: {
    alignSelf: "center",
    borderRadius: 16,
    overflow: "hidden",
  },
});
