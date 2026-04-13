import { forwardRef } from "react";
import { resolvePoemVersion } from "@shared/poemLanguage";
import { getPlatformLabel, getUiCopy } from "../uiCopy";
import type { MotionAsset, OriginalLanguage, PoemRecord, SharePlatform } from "@shared/types";
import CardBack from "./CardBack";

export interface VisualProfile {
  id: string;
  name: string;
  family: string;
  layout: "overlay" | "split" | "frame" | "margin";
  surface: string;
  surfaceAlt: string;
  textPrimary: string;
  textSecondary: string;
  accent: string;
  border: string;
  titleFont: string;
  bodyFont: string;
  mood: string;
}

interface PoemCardProps {
  poem: PoemRecord;
  uiLanguage: OriginalLanguage;
  displayLanguage: OriginalLanguage;
  dateLabel: string;
  profile: VisualProfile;
  asset?: MotionAsset;
  backImageUrl?: string;
  isFaceUp?: boolean;
  flipPhase?: "idle" | "turning-back" | "turning-front";
  onSaveText: () => void;
  onSaveRich: () => void;
  onShare: (platform: SharePlatform) => void;
  isBusy: boolean;
}

const sharePlatforms: SharePlatform[] = ["wechat", "xiaohongshu", "weibo", "douyin", "copy"];

const buildExcerpt = (lines: string[], maxLength = 84) => {
  const joined = lines.join(" ").trim();
  if (joined.length <= maxLength) {
    return joined;
  }
  return `${joined.slice(0, maxLength).trimEnd()}…`;
};

const shouldUsePoemBubble = (lines: string[]) => {
  const totalLines = lines.length;
  const totalCharacters = lines.join("").length;
  return totalLines >= 8 || totalCharacters >= 180;
};

const renderTextSection = (heading: string, title: string, lines: string[]) => (
  <section className="daily-card-section">
    <div className="daily-card-section-heading">{heading}</div>
    <h3>{title}</h3>
    <div className="daily-card-lines">
      {lines.map((line) => (
        <p key={`${heading}-${line}`}>{line}</p>
      ))}
    </div>
  </section>
);

const PoemCard = forwardRef<HTMLDivElement, PoemCardProps>(function PoemCard(
  { poem, uiLanguage, displayLanguage, dateLabel, profile, asset, backImageUrl, isFaceUp = true, flipPhase = "idle", onSaveText, onSaveRich, onShare, isBusy },
  ref,
) {
  const copy = getUiCopy(uiLanguage);
  const hasMotion = Boolean(asset?.motionUrl);
  const version = resolvePoemVersion(poem, displayLanguage);
  const usePoemBubble = shouldUsePoemBubble(version.lines);
  const excerpt = buildExcerpt(version.lines);

  return (
    <article
      ref={ref}
      className={`daily-card ${flipPhase !== "idle" ? `is-${flipPhase}` : ""}`.trim()}
      style={
        {
          "--card-surface": profile.surface,
          "--card-surface-alt": profile.surfaceAlt,
          "--card-text-primary": profile.textPrimary,
          "--card-text-secondary": profile.textSecondary,
          "--card-accent": profile.accent,
          "--card-border": profile.border,
          "--card-title-font": profile.titleFont,
          "--card-body-font": profile.bodyFont,
        } as React.CSSProperties
      }
    >
      <div className={`daily-card-flip-shell ${isFaceUp ? "is-face-up" : ""}`}>
        <div className="daily-card-flip-inner">
          <div className="daily-card-face daily-card-face-front">
            <div className="daily-card-shell">
              <div className="daily-card-media-stage">
                {asset?.sourceImageUrl ? <div className="daily-card-poster" style={{ backgroundImage: `url(${asset.sourceImageUrl})` }} /> : null}
                {hasMotion ? (
                  <video className="daily-card-motion" src={asset?.motionUrl} poster={asset?.sourceImageUrl} autoPlay loop muted playsInline preload="auto" />
                ) : (
                  <div className="daily-card-motion daily-card-motion-placeholder">
                    <span>{copy.generatingBackground}</span>
                  </div>
                )}
                <div className="daily-card-media-glow" />
                <div className="daily-card-media-veil" />
                <div className="daily-card-media-sheen" />
              </div>

              <div className="daily-card-content">
                <header className="daily-card-header">
                  <span className="daily-card-chip">{copy.featuredChip}</span>
                  <span className="daily-card-chip daily-card-chip-ghost">{dateLabel}</span>
                </header>

                <section className="daily-card-hero">
                  <div className="daily-card-style">{profile.name}</div>
                  <div className="daily-card-title-group">
                    <h1>{version.title}</h1>
                    <div className="daily-card-author">
                      <span>{poem.author}</span>
                      <span>{poem.authorMeta}</span>
                    </div>
                  </div>
                </section>

                <footer className="daily-card-footer">
                  <div className="daily-card-actions">
                    <button type="button" className="daily-card-action daily-card-action-primary" onClick={onSaveText} disabled={isBusy}>
                      {copy.saveText}
                    </button>
                    <button type="button" className="daily-card-action" onClick={onSaveRich} disabled={isBusy}>
                      {copy.saveRichCard}
                    </button>
                  </div>
                  <div className="daily-card-share-group">
                    {sharePlatforms.map((platform) => (
                      <button
                        key={platform.id}
                        type="button"
                        className="daily-card-share-chip"
                        data-platform={platform.id}
                        onClick={() => onShare(platform.id)}
                        disabled={isBusy}
                      >
                        {getPlatformLabel(uiLanguage, platform)}
                      </button>
                    ))}
                  </div>
                </footer>

                <div className="daily-card-text-panel">
                  {usePoemBubble ? (
                    <div className="daily-card-bubble-anchor">
                      <section className="daily-card-bubble-summary" tabIndex={0}>
                        <div className="daily-card-bubble-kicker">{version.heading}</div>
                        <div className="daily-card-bubble-excerpt-stack">
                          <p>{excerpt}</p>
                        </div>
                        <div className="daily-card-bubble-hint">{copy.hoverToReadFull}</div>
                      </section>

                      <section className="daily-card-bubble-full">
                        {renderTextSection(version.heading, version.title, version.lines)}
                      </section>
                    </div>
                  ) : (
                    <>
                      {renderTextSection(version.heading, version.title, version.lines)}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="daily-card-face daily-card-face-back">
            <CardBack subtle={!isFaceUp} imageUrl={backImageUrl} />
          </div>
        </div>
      </div>
    </article>
  );
});

export default PoemCard;