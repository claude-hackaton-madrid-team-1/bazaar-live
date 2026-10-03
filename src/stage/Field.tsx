/**
 * The room's light, drawn in CSS (stage.css): two soft fields of the voices' colours, a faint grid, a
 * reflective floor, a tint per mood and a pool of light on the side of whoever speaks. The layers only
 * fade (opacity), driven by the stage's data-mood and data-speaker.
 */
export function Field() {
  return (
    <div className="field" aria-hidden="true">
      <div className="field-light" />
      <div className="field-mood eager" />
      <div className="field-mood sarcastic" />
      <div className="field-mood triumphant" />
      <div className="field-speak seller" />
      <div className="field-speak buyer" />
      <div className="field-speak abuela" />
      <div className="field-speak chato" />
      <div className="field-grid" />
      <div className="field-floor" />
    </div>
  )
}
