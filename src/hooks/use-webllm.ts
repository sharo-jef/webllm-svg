"use client";

import type * as webllm from "@mlc-ai/web-llm";
import { useCallback, useRef, useState } from "react";

type MLCEngine = webllm.MLCEngineInterface;

interface ProgressInfo {
  progress: number;
  text: string;
}

export function useWebLLM() {
  const [isInitializing, setIsInitializing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("待機中");
  const engineRef = useRef<MLCEngine | null>(null);
  const currentModelRef = useRef<string | null>(null);

  const initializeEngine = useCallback(
    async (
      modelId: string,
      onProgress?: (info: ProgressInfo) => void,
      abortSignal?: AbortSignal,
    ) => {
      if (engineRef.current && currentModelRef.current === modelId) {
        return engineRef.current;
      }

      // Check if aborted before starting
      if (abortSignal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      setIsInitializing(true);
      setStatusText("モデルを初期化中...");

      try {
        const { CreateMLCEngine } = await import("@mlc-ai/web-llm");

        const engine = await CreateMLCEngine(modelId, {
          initProgressCallback: (progressInfo) => {
            // Check if aborted during initialization
            if (abortSignal?.aborted) {
              throw new DOMException("Aborted", "AbortError");
            }
            const percent = Math.round(progressInfo.progress * 100);
            setProgress(percent);
            setStatusText(progressInfo.text);
            onProgress?.(progressInfo);
          },
        });

        engineRef.current = engine;
        currentModelRef.current = modelId;
        setStatusText("準備完了");
        setProgress(100);
        return engine;
      } catch (error) {
        // Clear refs if initialization failed
        if (
          error instanceof Error &&
          (error.name === "AbortError" || error.message.includes("Aborted"))
        ) {
          // For abort errors, don't clear the refs as the engine might still be valid
          setStatusText("中止されました");
        } else {
          // For other errors, clear the refs
          engineRef.current = null;
          currentModelRef.current = null;
          setStatusText("エラー");
        }
        throw error;
      } finally {
        setIsInitializing(false);
      }
    },
    [],
  );

  const generateSVG = useCallback(
    async (params: {
      modelId: string;
      prompt: string;
      size: number;
      maxTokens: number;
      temperature: number;
      useCurrentColor: boolean;
      abortSignal?: AbortSignal;
      onProgress?: (info: ProgressInfo) => void;
      onChunk?: (chunk: string) => void;
      onGenerationStart?: () => void;
      onGenerationEnd?: () => void;
    }) => {
      setIsGenerating(true);

      try {
        const engine = await initializeEngine(
          params.modelId,
          params.onProgress,
          params.abortSignal,
        );

        // Check if aborted before starting
        if (params.abortSignal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }

        setStatusText("SVGを生成中...");
        params.onGenerationStart?.();

        const currentColorInstruction = params.useCurrentColor
          ? '\n- fill属性とstroke属性には "currentColor" を積極的に使用してください'
          : "";

        const systemPrompt = `あなたはSVG生成の専門家です。ユーザーの説明に基づいて、完全なSVGコードを生成してください。

SVG基本文法:
- 基本図形: <rect x="0" y="0" width="10" height="10" />, <circle cx="50" cy="50" r="20" />, <ellipse cx="50" cy="50" rx="30" ry="20" />, <line x1="0" y1="0" x2="100" y2="100" />
- パス: <path d="M x,y L x,y C x1,y1 x2,y2 x,y Z" /> (M=移動, L=直線, C=ベジェ曲線, Q=二次ベジェ, A=円弧, Z=閉じる)
- グループ化: <g transform="translate(x,y) rotate(deg) scale(n)">...</g>
- スタイル: fill="色", stroke="色", stroke-width="幅", opacity="0-1"
- グラデーション: <defs><linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="色"/><stop offset="100%" stop-color="色"/></linearGradient></defs> で定義し fill="url(#grad)" で使用
- フィルター: <filter id="shadow"><feGaussianBlur in="SourceAlpha" stdDeviation="3"/><feOffset dx="2" dy="2"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter> で定義し filter="url(#shadow)" で使用

要件:
- viewBox="0 0 ${params.size} ${params.size}" を使用
- 完全に独立したSVGとして動作すること
- グラデーション、シャドウ、その他の高度なSVG機能を積極的に使用${currentColorInstruction}
- XMLコメントや説明文は不要
- <svg>タグから</svg>タグまでの完全なコードのみを出力
- コードブロック(\`\`\`)は使わず、直接SVGコードを出力`;

        const messages: Array<{
          role: "system" | "user";
          content: string;
        }> = [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `次のアイコンのSVGコードを生成してください: ${params.prompt}`,
          },
        ];

        let fullResponse = "";
        const chunks = await engine.chat.completions.create({
          messages,
          temperature: params.temperature,
          max_tokens: params.maxTokens,
          stream: true,
        });

        for await (const chunk of chunks) {
          // Check if aborted during streaming
          if (params.abortSignal?.aborted) {
            throw new DOMException("Aborted", "AbortError");
          }
          const content = chunk.choices[0]?.delta?.content || "";
          fullResponse += content;
          params.onChunk?.(content);
        }

        params.onGenerationEnd?.();
        setStatusText("待機中");
        return fullResponse;
      } catch (error) {
        setStatusText("エラー");
        throw error;
      } finally {
        setIsGenerating(false);
      }
    },
    [initializeEngine],
  );

  const resetEngine = useCallback(() => {
    engineRef.current = null;
    currentModelRef.current = null;
    setStatusText("待機中");
    setProgress(0);
  }, []);

  const hasModelInCache = useCallback(
    async (modelId: string): Promise<boolean> => {
      try {
        const { hasModelInCache } = await import("@mlc-ai/web-llm");
        return await hasModelInCache(modelId);
      } catch {
        return false;
      }
    },
    [],
  );

  const deleteModelCache = useCallback(async (modelId: string) => {
    try {
      const { deleteModelInCache } = await import("@mlc-ai/web-llm");
      await deleteModelInCache(modelId);

      // Also clear Cache Storage for this model
      if (typeof caches !== "undefined") {
        const cacheNames = await caches.keys();
        for (const cacheName of cacheNames) {
          if (cacheName.includes(modelId)) {
            await caches.delete(cacheName);
          }
        }
      }
    } catch (error) {
      console.error("Failed to delete cache:", error);
      throw error;
    }
  }, []);

  const deleteAllModelCache = useCallback(async () => {
    try {
      // Delete all IndexedDB databases
      if (typeof indexedDB !== "undefined") {
        const databases = await indexedDB.databases();
        for (const db of databases) {
          indexedDB.deleteDatabase(db.name || "");
        }
      }

      // Delete all Cache Storage
      if (typeof caches !== "undefined") {
        const cacheNames = await caches.keys();
        for (const cacheName of cacheNames) {
          await caches.delete(cacheName);
        }
      }

      // Clear LocalStorage
      if (typeof localStorage !== "undefined") {
        localStorage.clear();
      }

      // Clear SessionStorage
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.clear();
      }

      // Unregister Service Workers
      if (typeof navigator !== "undefined" && navigator.serviceWorker) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const registration of registrations) {
          await registration.unregister();
        }
      }
    } catch (error) {
      console.error("Failed to delete all cache:", error);
      throw error;
    }
  }, []);

  const interruptGenerate = useCallback(async () => {
    if (engineRef.current) {
      await engineRef.current.interruptGenerate();
    }
  }, []);

  return {
    isInitializing,
    isGenerating,
    progress,
    statusText,
    generateSVG,
    resetEngine,
    interruptGenerate,
    hasModelInCache,
    deleteModelCache,
    deleteAllModelCache,
  };
}
