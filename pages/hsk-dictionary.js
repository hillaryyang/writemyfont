// HSK Character Dictionary - Dynamic vocabulary loader for Chinese character practice
// Based on https://github.com/drkameleon/complete-hsk-vocabulary

// Dynamic HSK vocabulary loader
let CHARACTER_DECKS = {
  "HSK 1": [],
  "HSK 2": [],
  "HSK 3": [],
  "HSK 4": [],
  "HSK 5": [],
  "HSK 6": []
};

// Loading state
let isLoading = false;
let loadedLevels = new Set();

// Base URL for the HSK vocabulary repository (exclusive = only new words for each level)
const HSK_BASE_URL = 'https://raw.githubusercontent.com/drkameleon/complete-hsk-vocabulary/main/wordlists/exclusive/new/';

// Function to convert HSK data format to our app format
function convertHSKEntry(entry) {
  // HSK format: 
  // {
  //   "simplified": "爱",
  //   "forms": [
  //     {
  //       "traditional": "愛",
  //       "transcriptions": { "pinyin": "ài" },
  //       "meanings": ["to love; to be fond of; to like"]
  //     }
  //   ]
  // }
  
  const char = entry.simplified || entry.traditional || '';
  
  // Extract pinyin and meanings from the forms array
  let pinyin = '';
  let meanings = [];
  
  if (entry.forms && Array.isArray(entry.forms) && entry.forms.length > 0) {
    const firstForm = entry.forms[0];
    
    // Get pinyin from transcriptions
    if (firstForm.transcriptions && firstForm.transcriptions.pinyin) {
      pinyin = firstForm.transcriptions.pinyin;
    }
    
    // Get meanings
    if (firstForm.meanings && Array.isArray(firstForm.meanings)) {
      meanings = firstForm.meanings;
    }
  }
  
  const meaning = meanings.length > 0 ? meanings.join('; ') : '';
  
  return {
    char: char,
    pinyin: pinyin,
    meaning: meaning,
    exampleZh: '', // No examples
    exampleEn: ''  // No examples
  };
}

// Function to load HSK level data
async function loadHSKLevel(level) {
  if (loadedLevels.has(level) || isLoading) {
    return CHARACTER_DECKS[`HSK ${level}`];
  }
  
  isLoading = true;
  
  try {
    const url = `${HSK_BASE_URL}${level}.json`;
    console.log(`Loading HSK ${level} vocabulary from: ${url}`);
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText} - URL: ${url}`);
    }
    
    const data = await response.json();
    console.log(`Loaded ${data.length} words for HSK ${level}`);
    
    // Convert to our format and filter for single characters only
    const convertedEntries = data
      .filter(entry => {
        const char = entry.simplified || entry.traditional;
        return char && char.length === 1; // Only single characters for writing practice
      })
      .map(convertHSKEntry)
      .filter(entry => entry.char && entry.pinyin && entry.meaning); // Only keep complete entries
    
    CHARACTER_DECKS[`HSK ${level}`] = convertedEntries;
    loadedLevels.add(level);
    
    // Dispatch custom event to notify the main app that data is loaded
    window.dispatchEvent(new CustomEvent('hskDataLoaded', { 
      detail: { level, count: convertedEntries.length } 
    }));
    
    console.log(`HSK ${level} loaded: ${convertedEntries.length} single characters out of ${data.length} total words`);
    return convertedEntries;
    
  } catch (error) {
    console.error(`Error loading HSK ${level}:`, error);
    
    // Fallback to basic data
    const fallbackData = getFallbackData(level);
    CHARACTER_DECKS[`HSK ${level}`] = fallbackData;
    loadedLevels.add(level);
    
    window.dispatchEvent(new CustomEvent('hskDataLoaded', { 
      detail: { level, count: fallbackData.length, error: error.message } 
    }));
    
    return fallbackData;
  } finally {
    isLoading = false;
  }
}

// Fallback data in case of network issues
function getFallbackData(level) {
  const fallbacks = {
    1: [
      { char: "学", pinyin: "xué", meaning: "to study; learn", exampleZh: "", exampleEn: "" },
      { char: "人", pinyin: "rén", meaning: "person", exampleZh: "", exampleEn: "" },
      { char: "你", pinyin: "nǐ", meaning: "you", exampleZh: "", exampleEn: "" },
      { char: "我", pinyin: "wǒ", meaning: "I; me", exampleZh: "", exampleEn: "" },
      { char: "中", pinyin: "zhōng", meaning: "middle; center", exampleZh: "", exampleEn: "" },
      { char: "国", pinyin: "guó", meaning: "country; nation", exampleZh: "", exampleEn: "" }
    ],
    2: [
      { char: "班", pinyin: "bān", meaning: "class", exampleZh: "", exampleEn: "" },
      { char: "办", pinyin: "bàn", meaning: "to handle", exampleZh: "", exampleEn: "" },
      { char: "半", pinyin: "bàn", meaning: "half", exampleZh: "", exampleEn: "" },
      { char: "帮", pinyin: "bāng", meaning: "to help", exampleZh: "", exampleEn: "" }
    ],
    3: [
      { char: "包", pinyin: "bāo", meaning: "bag; to wrap", exampleZh: "", exampleEn: "" },
      { char: "报", pinyin: "bào", meaning: "newspaper; to report", exampleZh: "", exampleEn: "" },
      { char: "被", pinyin: "bèi", meaning: "by (passive voice)", exampleZh: "", exampleEn: "" },
      { char: "比", pinyin: "bǐ", meaning: "to compare", exampleZh: "", exampleEn: "" }
    ],
    4: [
      { char: "稳", pinyin: "wěn", meaning: "settled; steady; stable", exampleZh: "", exampleEn: "" },
      { char: "承", pinyin: "chéng", meaning: "to bear; to carry", exampleZh: "", exampleEn: "" },
      { char: "担", pinyin: "dān", meaning: "to carry; to shoulder", exampleZh: "", exampleEn: "" },
      { char: "获", pinyin: "huò", meaning: "to obtain; to get", exampleZh: "", exampleEn: "" }
    ]
  };
  
  return fallbacks[level] || [];
}

// Function to preload all HSK levels
async function preloadAllHSKLevels() {
  const levels = [1, 2, 3, 4, 5, 6];
  const promises = levels.map(level => loadHSKLevel(level));
  
  try {
    await Promise.all(promises);
    console.log('All HSK levels loaded successfully');
  } catch (error) {
    console.log('Some HSK levels failed to load, using fallback data');
  }
}

// Export for use in main app
window.CHARACTER_DECKS = CHARACTER_DECKS;
window.loadHSKLevel = loadHSKLevel;
window.preloadAllHSKLevels = preloadAllHSKLevels;
