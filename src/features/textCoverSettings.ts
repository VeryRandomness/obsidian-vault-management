// Settings of the text cover feature, saved under "textCover" in the plugin's shared settings.

export interface TextCoverSettings {
  /** Frontmatter property to use as explicit cover text */
  contentProperty: string;
  /** Use the file title as the cover text instead of the note body */
  defaultToTitle: boolean;
  /** Fall back to extracting text from note body when no property found */
  fallbackToBody: boolean;
  /** Max characters before text is truncated */
  maxChars: number;
  /** Default CSS background (color or gradient) */
  defaultBg: string;
  /** Default CSS text color */
  defaultColor: string;
  /** Font size for cover text */
  fontSize: string;
  /** Padding inside cover */
  padding: string;
  /** Show opening quote mark decoration */
  showQuoteMark: boolean;
  /** Vault-relative folder to save downloaded remote covers into */
  coversFolder: string;
  /** Automatically download remote cover URLs as notes are indexed */
  autoDownloadCovers: boolean;
  /** Log debug info to console */
  debugMode: boolean;
}

export const DEFAULT_TEXT_COVER: TextCoverSettings = {
  contentProperty: 'textCover',
  defaultToTitle: false,
  fallbackToBody: true,
  maxChars: 300,
  defaultBg: 'linear-gradient(160deg, #1a1a2e 0%, #16213e 55%, #0f3460 100%)',
  defaultColor: '#e0e0e0',
  fontSize: '0.82em',
  padding: '1em 1.1em',
  showQuoteMark: true,
  coversFolder: 'Covers',
  autoDownloadCovers: true,
  debugMode: false,
};
