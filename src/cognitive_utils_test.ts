// src/cognitive_utils_test.ts

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { getDominantEmotion, formatEmotionState, getEmotionKeywords } from "./cognitive_utils.ts";
import type { EmotionDimension } from "./qdrant_client.ts";

Deno.test("getDominantEmotion should return correct dominant emotion", () => {
  assertEquals(
    getDominantEmotion({ joy: 0.8, sadness: 0.1, anger: 0.1 }),
    "joy",
    "Clear single dominant emotion (joy)",
  );
  assertEquals(
    getDominantEmotion({ joy: 0.6, sadness: 0.5, anger: 0.1 }),
    "joy",
    "Similar scores, joy slightly higher",
  );
  assertEquals(
    getDominantEmotion({ joy: 0.2, sadness: 0.1, anger: 0.15 }),
    "neutral",
    "All scores low, should return neutral",
  );
  assertEquals(
    getDominantEmotion({ neutral: 1.0 }),
    "neutral",
    "Only neutral score",
  );
  assertEquals(
    getDominantEmotion({}),
    "neutral",
    "Empty emotion object",
  );
  assertEquals(
    getDominantEmotion({ joy: 0.9, fear: 0.8, neutral: 0.5 }),
    "joy",
    "Joy dominant over fear and neutral",
  );
  assertEquals(
    getDominantEmotion({ sadness: 0.7, anger: 0.75, neutral: 0.1 }),
    "anger",
    "Anger slightly higher than sadness",
  );
   assertEquals(
    getDominantEmotion({ joy: 0.3, sadness: 0.2, anger: 0.25, neutral: 0.9 }),
    "neutral",
    "Neutral dominant even if other scores present but low",
  );
  assertEquals(
    getDominantEmotion({ joy: 0.4, neutral: 0.3 }),
    "joy",
    "One distinct emotion above threshold, neutral lower"
  );
});

Deno.test("formatEmotionState should format sentiment correctly", () => {
  assertEquals(
    formatEmotionState({ valence: 0.8, arousal: 0.8, dominant_emotion: "joy" }),
    "非常积极/非常强烈，主要情绪倾向于joy",
    "Very positive, very strong, with dominant emotion joy"
  );
  assertEquals(
    formatEmotionState({ valence: 0.4, arousal: 0.5 }),
    "积极/中等强度",
    "Positive, medium arousal, no dominant emotion"
  );
  assertEquals(
    formatEmotionState({ valence: 0.0, arousal: 0.1, dominant_emotion: "neutral" }),
    "中性/平静，主要情绪倾向于neutral",
    "Neutral, calm, with dominant emotion neutral"
  );
  assertEquals(
    formatEmotionState({ valence: -0.4, arousal: 0.6 }),
    "消极/中等强度",
    "Negative, medium arousal"
  );
  assertEquals(
    formatEmotionState({ valence: -0.8, arousal: 0.9, dominant_emotion: "sadness" }),
    "非常消极/非常强烈，主要情绪倾向于sadness",
    "Very negative, very strong, with dominant emotion sadness"
  );
  assertEquals(
    formatEmotionState({ valence: 0.1, arousal: 0.3 }),
    "中性/平静",
    "Slightly positive (neutral), slightly aroused (calm)"
  );
});

Deno.test("getEmotionKeywords should return appropriate keywords", () => {
  assertEquals(
    getEmotionKeywords({ valence: 0.8, arousal: 0.8, emotionDimensions: { joy: 0.9 } }),
    ["兴奋", "喜悦", "激动"], // Dominant joy not explicitly added if already covered by valence/arousal
    "Very positive, very strong, dominant joy"
  );
  assertEquals(
    getEmotionKeywords({ valence: 0.8, arousal: 0.8, emotionDimensions: { joy: 0.9, surprise: 0.7 } }),
    ["兴奋", "喜悦", "激动"], // 'joy' is dominant and its keywords are already present
    "Very positive, very strong, dominant joy with surprise"
  );
   assertEquals(
    getEmotionKeywords({ valence: 0.1, arousal: 0.1, emotionDimensions: { neutral: 0.9 } }),
    ["平静", "中性"], // Max 3 keywords, neutral is added if it's the dominant one and not covered
    "Neutral, calm, dominant neutral"
  );
  assertEquals(
    getEmotionKeywords({ valence: -0.7, arousal: 0.7, emotionDimensions: { sadness: 0.8, fear: 0.6 } }),
    ["沮丧", "悲伤", "投入"], // sadness is dominant
    "Very negative, strong, dominant sadness"
  );
   assertEquals(
    getEmotionKeywords({ valence: -0.2, arousal: 0.2, emotionDimensions: { anger: 0.4 } }),
    ["平静", "中性", "anger"],
    "Slightly negative (neutral), calm, dominant anger"
  );
  assertEquals(
    getEmotionKeywords({ valence: 0.5, arousal: 0.5, emotionDimensions: {} }),
    ["积极", "愉快", "投入"],
    "Positive, medium arousal, no specific dominant emotion in dimensions"
  );
   assertEquals(
    getEmotionKeywords({ valence: 0.0, arousal: 0.0, emotionDimensions: { "neutral": 1.0 } }),
    ["平静", "中性"], // Max 3 keywords, neutral is added
    "Perfectly neutral and calm"
  );
});
