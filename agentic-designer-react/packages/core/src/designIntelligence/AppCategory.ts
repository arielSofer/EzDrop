// Ported 1:1 from AgenticDesigner/DesignIntelligence/AppCategory.swift

// סוגי אפליקציות שהמערכת יודעת לעצב עבורם
export const AllAppCategory = [
  'finance',
  'banking',
  'trading',
  'fitness',
  'health',
  'mentalHealth',
  'travel',
  'ecommerce',
  'foodDelivery',
  'education',
  'productivity',
  'aiChat',
  'social',
  'realEstate',
  'music',
  'crypto',
  'calendar',
  'habitTracker',
  'generic',
] as const;
export type AppCategory = (typeof AllAppCategory)[number];

export const AppCategoryClassifier = {
  // מזהה קטגוריית אפליקציה לפי הפרומפט.
  // Matching is word-based (not substring) so short keywords like "ai" or "run"
  // don't fire inside unrelated words ("email", "brunch", "nail").
  classify(prompt: string): AppCategory {
    const text = prompt.toLowerCase();
    // components(separatedBy: CharacterSet.alphanumerics.inverted).filter { !$0.isEmpty }
    const tokens = new Set(text.split(/[^\p{L}\p{N}]/u).filter((token) => token.length > 0));

    const word = (words: string[]): boolean => words.some((w) => tokens.has(w));

    const stem = (stems: string[]): boolean => {
      for (const token of tokens) {
        if (stems.some((s) => token.startsWith(s))) return true;
      }
      return false;
    };

    if (
      word(['trading', 'stock', 'stocks', 'forex', 'crypto', 'broker', 'brokerage', 'portfolio',
        'מסחר', 'מניות', 'השקעות', 'השקעה', 'קריפטו', 'ברוקר', 'פורטפוליו']) ||
      stem(['invest']) ||
      text.includes('תיק השקעות')
    ) {
      return 'trading';
    }

    if (
      word(['finance', 'financial', 'bank', 'banking', 'wallet', 'budget',
        'כסף', 'בנק', 'ארנק', 'פיננסים', 'פיננסי', 'תקציב']) ||
      stem(['פיננס'])
    ) {
      return 'finance';
    }

    // stem() keeps typo tolerance: "runing", "runnning", "joging" still match.
    if (
      word(['fitness', 'workout', 'workouts', 'gym', 'marathon', 'training', 'tempo',
        'pace', 'sport', 'sports',
        'כושר', 'אימון', 'אימונים', 'ריצה', 'ריצות', 'רץ', 'רצים', 'הליכה', 'ספורט', 'קצב', 'מסלול']) ||
      stem(['run', 'jog'])
    ) {
      return 'fitness';
    }

    if (word(['mental', 'therapy', 'wellness', 'meditation', 'mindfulness', 'calm',
      'מדיטציה', 'נפש', 'רוגע', 'מיינדפולנס'])) {
      return 'mentalHealth';
    }

    if (word(['travel', 'hotel', 'hotels', 'flight', 'flights', 'trip', 'trips', 'vacation',
      'טיול', 'טיולים', 'נסיעה', 'נסיעות', 'מלון', 'מלונות', 'טיסה', 'טיסות', 'חופשה'])) {
      return 'travel';
    }

    if (word(['shop', 'shopping', 'ecommerce', 'store', 'marketplace', 'product', 'products',
      'חנות', 'קניות', 'מוצר', 'מוצרים'])) {
      return 'ecommerce';
    }

    if (word(['food', 'delivery', 'restaurant', 'restaurants', 'recipe', 'recipes',
      'אוכל', 'משלוחים', 'מסעדה', 'מסעדות', 'מתכון', 'מתכונים'])) {
      return 'foodDelivery';
    }

    if (word(['learn', 'learning', 'course', 'courses', 'education', 'school', 'study',
      'לימוד', 'לימודים', 'קורס', 'קורסים', 'חינוך'])) {
      return 'education';
    }

    if (word(['spotify', 'music', 'song', 'songs', 'playlist', 'playlists', 'audio', 'podcast', 'podcasts',
      'מוזיקה', 'שיר', 'שירים', 'פלייליסט', 'ספוטיפיי', 'פודקאסט'])) {
      return 'music';
    }

    if (
      word(['ai', 'chat', 'chatbot', 'assistant', 'messaging', 'messenger', 'messages',
        'צאט', 'שיחה', 'הודעות', 'עוזר']) ||
      text.includes("צ'אט")
    ) {
      return 'aiChat';
    }

    if (word(['habit', 'habits', 'routine', 'routines', 'streak', 'streaks', 'הרגל', 'הרגלים'])) {
      return 'habitTracker';
    }

    return 'generic';
  },
};
