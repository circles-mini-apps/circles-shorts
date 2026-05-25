/** Minimum characters required in the flag explanation. */
export const MIN_FLAG_CHARS = 20;

/** @typedef {{ value: string, label: string, description: string }} FlagCategory */

/** @type {FlagCategory[]} */
export const FLAG_CATEGORIES = [
  {
    value: 'incorrect-content-info',
    label: 'Incorrect Content Information',
    description:
      'The title, genre, or description does not match the video (e.g., wrong category, misleading title, clickbait label, or content that is not what was advertised).',
  },
  {
    value: 'duplicate-content',
    label: 'Duplicate Content',
    description:
      'This short is the same video or substantially the same content already published on Circles Shorts by this creator or someone else.',
  },
  {
    value: 'hate-speech',
    label: 'Hate Speech',
    description:
      'Content that promotes violence or incites hatred against groups based on race, religion, gender, sexual orientation, etc.',
  },
  {
    value: 'harassment-bullying',
    label: 'Harassment & Bullying',
    description: 'Targeted abuse, threats, or repeated unwanted contact directed at individuals.',
  },
  {
    value: 'violence-graphic',
    label: 'Violence or Graphic Content',
    description:
      'Depictions of extreme violence, gore, or acts that shock or disgust viewers without educational or news context.',
  },
  {
    value: 'sexually-explicit',
    label: 'Sexually Explicit Content',
    description: 'Pornography, nudity, or sexually suggestive material that violates community guidelines.',
  },
  {
    value: 'misinformation',
    label: 'Misinformation & Disinformation',
    description:
      'False claims that can cause real-world harm (e.g., medical misinformation, election fraud claims).',
  },
  {
    value: 'dangerous-acts',
    label: 'Dangerous Acts or Challenges',
    description: 'Content encouraging risky behavior (e.g., viral challenges that lead to injury).',
  },
  {
    value: 'copyright',
    label: 'Copyright Infringement',
    description: 'Use of music, footage, or images without proper licensing or permission.',
  },
  {
    value: 'spam-deceptive',
    label: 'Spam & Deceptive Practices',
    description: 'Clickbait, scams, phishing links, or repetitive low-value content.',
  },
  {
    value: 'child-safety',
    label: 'Child Safety Violations',
    description:
      'Any content that endangers minors, including sexualization or exploitation of children.',
  },
  {
    value: 'terrorist-extremist',
    label: 'Terrorist or Violent Extremist Content',
    description: 'Material that promotes or glorifies terrorist organizations or acts.',
  },
  {
    value: 'impersonation',
    label: 'Impersonation',
    description: 'Pretending to be someone else (individuals, brands, or organizations) in a misleading way.',
  },
  {
    value: 'regulated-goods',
    label: 'Regulated Goods & Services',
    description: 'Promotion of illegal drugs, firearms, or other restricted items.',
  },
  {
    value: 'other',
    label: 'Other Policy Violation',
    description:
      'The content breaks community rules in a way not covered by the categories above. Use this only when no other reason applies, and explain clearly in your reasoning.',
  },
];

export function flagCategoryLabel(value) {
  return FLAG_CATEGORIES.find((c) => c.value === value)?.label || value || 'Report';
}

export function flagCategoryDescription(value) {
  return FLAG_CATEGORIES.find((c) => c.value === value)?.description || '';
}
