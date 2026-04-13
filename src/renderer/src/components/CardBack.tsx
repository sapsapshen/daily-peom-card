interface CardBackProps {
  className?: string;
  subtle?: boolean;
  imageUrl?: string;
  motionUrl?: string;
  posterUrl?: string;
}

function CardBack({ className = "", subtle = false, imageUrl, motionUrl, posterUrl }: CardBackProps) {
  const baseImageUrl = posterUrl ?? imageUrl;

  return (
    <div
      className={`card-back ${motionUrl ? "has-motion" : imageUrl ? "has-image" : ""} ${subtle ? "is-subtle" : ""} ${className}`.trim()}
      aria-hidden="true"
    >
      {baseImageUrl ? <div className="card-back-image" style={{ backgroundImage: `url(${baseImageUrl})` }} /> : null}
      {motionUrl ? (
        <video className="card-back-motion" src={motionUrl} poster={baseImageUrl} autoPlay loop muted playsInline preload="metadata" />
      ) : null}
      {motionUrl || baseImageUrl ? null : (
        <div className="card-back-frame">
          <div className="card-back-plate card-back-plate-top" />
          <div className="card-back-plate card-back-plate-bottom" />
          <div className="card-back-cable card-back-cable-left" />
          <div className="card-back-cable card-back-cable-right" />
          <div className="card-back-emblem">
            <div className="card-back-emblem-core" />
            <div className="card-back-emblem-mark" />
          </div>
          <div className="card-back-bolt card-back-bolt-tl" />
          <div className="card-back-bolt card-back-bolt-tr" />
          <div className="card-back-bolt card-back-bolt-bl" />
          <div className="card-back-bolt card-back-bolt-br" />
        </div>
      )}
      <div className="card-back-glow" />
    </div>
  );
}

export default CardBack;