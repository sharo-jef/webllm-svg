"use client";

import isSvg from "is-svg";
import {
  Check,
  Clock,
  Copy,
  Download,
  History,
  Sparkles,
  Trash2,
} from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AppNavbar } from "@/components/app-navbar";
import {
  CodeBlock,
  CodeBlockBody,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockItem,
} from "@/components/kibo-ui/code-block";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useWebLLM } from "@/hooks/use-webllm";

interface ModelCategory {
  label: string;
  models: string[];
}

const formatElapsedTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins > 0) {
    return `${mins}m ${secs}s`;
  }
  return `${secs}s`;
};

// Memoized status display component to prevent re-renders
const StatusDisplay = memo(
  ({
    statusText,
    startTime,
    elapsedTime,
    isInitializing,
    isGenerating,
    progress,
  }: {
    statusText: string;
    startTime: number | null;
    elapsedTime: number;
    isInitializing: boolean;
    isGenerating: boolean;
    progress: number;
  }) => (
    <Card className="p-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-sm font-medium">現在の状態</div>
            <div className="text-sm text-muted-foreground">
              {statusText}
              {startTime !== null && (
                <span className="ml-2 text-xs">
                  ({formatElapsedTime(elapsedTime)})
                </span>
              )}
            </div>
          </div>
          <Badge
            variant={isInitializing || isGenerating ? "default" : "secondary"}
          >
            {isInitializing || isGenerating ? "実行中" : "待機中"}
          </Badge>
        </div>

        {(isInitializing || isGenerating) && <Progress value={progress} />}
      </div>
    </Card>
  ),
);
StatusDisplay.displayName = "StatusDisplay";

// Memoized model selector component to prevent re-renders
const ModelSelector = memo(
  ({
    models,
    cachedModels,
    selectedModel,
    onModelChange,
    onDeleteCache,
    isInitializing,
    isGenerating,
  }: {
    models: Record<string, ModelCategory>;
    cachedModels: Set<string>;
    selectedModel: string;
    onModelChange: (value: string) => void;
    onDeleteCache: (modelId: string) => void;
    isInitializing: boolean;
    isGenerating: boolean;
  }) => (
    <div className="space-y-2 lg:col-span-4">
      <Label htmlFor="model">AIモデル</Label>
      <div className="flex gap-2">
        <Select value={selectedModel} onValueChange={onModelChange}>
          <SelectTrigger id="model" className="flex-1">
            <SelectValue placeholder="モデルを選択" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(models).map(([key, category]) =>
              category.models.length > 0 ? (
                <SelectGroup key={key}>
                  <SelectLabel>{category.label}</SelectLabel>
                  {category.models.map((model) => (
                    <SelectItem key={model} value={model}>
                      <div className="flex items-center gap-2">
                        <span>{model}</span>
                        {cachedModels.has(model) && (
                          <Check className="h-3 w-3 text-green-600" />
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectGroup>
              ) : null,
            )}
          </SelectContent>
        </Select>
        {selectedModel && cachedModels.has(selectedModel) && (
          <Button
            onClick={() => onDeleteCache(selectedModel)}
            disabled={isInitializing || isGenerating}
            variant="outline"
            size="icon"
            title="このモデルのキャッシュを削除"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  ),
);
ModelSelector.displayName = "ModelSelector";

export default function SVGGenerator() {
  const [models, setModels] = useState<Record<string, ModelCategory>>({});
  const [cachedModels, setCachedModels] = useState<Set<string>>(new Set());
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState(64);
  const [maxTokens, setMaxTokens] = useState(10000);
  const [temperature, setTemperature] = useState(0.2);
  const [useCurrentColor, setUseCurrentColor] = useState(true);
  const [aiRawOutput, setAiRawOutput] = useState("");
  const [extractedSVGs, setExtractedSVGs] = useState<string[]>([]);
  const [selectedSVGIndex, setSelectedSVGIndex] = useState(0);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [autoScrollRaw, setAutoScrollRaw] = useState(true);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [lastPromptParams, setLastPromptParams] = useState<{
    prompt: string;
    model: string;
    size: number;
    maxTokens: number;
    temperature: number;
    useCurrentColor: boolean;
  } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const aiOutputRef = useRef<HTMLDivElement>(null);
  const shouldStopRef = useRef(false);
  const HISTORY_STORAGE_KEY = "svg-generator-prompt-history";
  const MODEL_STORAGE_KEY = "svg-generator-selected-model";
  const PROMPT_STORAGE_KEY = "svg-generator-current-prompt";
  const MAX_HISTORY = 50;

  const {
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
  } = useWebLLM();

  const addLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setDebugLogs((prev) => [...prev, `[${timestamp}] ${message}`]);
  }, []);

  // Load prompt history from LocalStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(HISTORY_STORAGE_KEY);
      if (saved) {
        setPromptHistory(JSON.parse(saved));
      }

      // Restore last prompt
      const savedPrompt = localStorage.getItem(PROMPT_STORAGE_KEY);
      if (savedPrompt) {
        setPrompt(savedPrompt);
      }
    } catch (error) {
      console.error("Failed to load prompt history:", error);
    }
  }, []);

  // Save prompt to history
  const saveToHistory = useCallback((newPrompt: string) => {
    if (!newPrompt.trim()) return;

    setPromptHistory((prev) => {
      const filtered = prev.filter((p) => p !== newPrompt);
      const updated = [newPrompt, ...filtered].slice(0, MAX_HISTORY);
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
    setHistoryIndex(-1);
  }, []);

  // Delete history item
  const deleteHistoryItem = useCallback((index: number) => {
    setPromptHistory((prev) => {
      const updated = prev.filter((_, i) => i !== index);
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  // Clear all history
  const clearHistory = useCallback(() => {
    setPromptHistory([]);
    localStorage.removeItem(HISTORY_STORAGE_KEY);
    setHistoryIndex(-1);
    toast.success("履歴をすべて削除しました");
  }, []);

  // Handle keyboard navigation in textarea
  const handlePromptKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Ctrl+Enter to generate
      if (e.key === "Enter" && e.ctrlKey) {
        e.preventDefault();
        if (!isInitializing && !isGenerating) {
          handleGenerate();
        }
        return;
      }

      const textarea = e.currentTarget;
      const cursorPosition = textarea.selectionStart;
      const lines = textarea.value.substring(0, cursorPosition).split("\n");
      const currentLineNumber = lines.length;

      if (
        e.key === "ArrowUp" &&
        currentLineNumber === 1 &&
        promptHistory.length > 0
      ) {
        e.preventDefault();
        const newIndex = Math.min(historyIndex + 1, promptHistory.length - 1);
        setHistoryIndex(newIndex);
        setPrompt(promptHistory[newIndex]);
      } else if (e.key === "ArrowDown" && historyIndex > -1) {
        e.preventDefault();
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setPrompt(newIndex === -1 ? "" : promptHistory[newIndex]);
      }
    },
    [promptHistory, historyIndex, isInitializing, isGenerating],
  );

  useEffect(() => {
    const loadModels = async () => {
      try {
        const { prebuiltAppConfig } = await import("@mlc-ai/web-llm");

        if (!prebuiltAppConfig?.model_list) {
          addLog("error: Failed to fetch model list");
          return;
        }

        const allModels = prebuiltAppConfig.model_list;
        const categories: Record<string, ModelCategory> = {
          llama: { label: "Llama 3.1/3.2 (Meta)", models: [] },
          qwen: { label: "Qwen2.5 (Alibaba)", models: [] },
          deepseek: { label: "DeepSeek-R1-Distill", models: [] },
          phi: { label: "Phi-3.5 (Microsoft)", models: [] },
          mistral: { label: "Mistral 7B", models: [] },
          gemma: { label: "Gemma-2 (Google)", models: [] },
          other: { label: "その他のモデル", models: [] },
        };

        // Filter for text generation models only (exclude embedding and vision models)
        const textGenerationModels = allModels.filter((model) => {
          const id = model.model_id.toLowerCase();
          // Exclude embedding models and vision models
          return (
            !id.includes("embedding") &&
            !id.includes("vision") &&
            !id.includes("clip")
          );
        });

        textGenerationModels.forEach((model) => {
          const id = model.model_id.toLowerCase();

          if (
            id.includes("llama") &&
            (id.includes("3.1") ||
              id.includes("3.2") ||
              id.includes("3_1") ||
              id.includes("3_2"))
          ) {
            categories.llama.models.push(model.model_id);
          } else if (id.includes("qwen")) {
            categories.qwen.models.push(model.model_id);
          } else if (id.includes("deepseek")) {
            categories.deepseek.models.push(model.model_id);
          } else if (id.includes("phi")) {
            categories.phi.models.push(model.model_id);
          } else if (id.includes("mistral") || id.includes("hermes")) {
            categories.mistral.models.push(model.model_id);
          } else if (id.includes("gemma")) {
            categories.gemma.models.push(model.model_id);
          } else {
            categories.other.models.push(model.model_id);
          }
        });

        // Load saved model or use default
        const savedModel = localStorage.getItem(MODEL_STORAGE_KEY);
        const defaultModel =
          (savedModel &&
            allModels.find((m) => m.model_id === savedModel)?.model_id) ||
          categories.qwen.models.find((m) => m.includes("7B")) ||
          categories.llama.models.find((m) => m.includes("8B")) ||
          categories.mistral.models[0] ||
          allModels[0]?.model_id;

        if (defaultModel) {
          setSelectedModel(defaultModel);
          addLog(
            `success: ${savedModel && savedModel === defaultModel ? "Restored" : "Default"} model selected: ${defaultModel}`,
          );
        }

        setModels(categories);
        addLog("success: Model list loaded");

        // キャッシュされているモデルを確認
        const cached = new Set<string>();
        for (const model of textGenerationModels) {
          if (await hasModelInCache(model.model_id)) {
            cached.add(model.model_id);
          }
        }
        setCachedModels(cached);
        addLog(`info: Found ${cached.size} cached model(s)`);
      } catch (error) {
        addLog(`error: Failed to load model list: ${error}`);
      }
    };

    loadModels();
  }, [addLog, hasModelInCache]);

  useEffect(() => {
    if (startTime === null) return;

    const interval = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
    }, 100);

    return () => clearInterval(interval);
  }, [startTime]);

  // Auto-scroll for AI Output
  useEffect(() => {
    if (autoScrollRaw && aiOutputRef.current && aiRawOutput) {
      const scrollContainer =
        aiOutputRef.current.querySelector(".overflow-auto");
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [aiRawOutput, autoScrollRaw]);

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      toast.error("プロンプトを入力してください");
      return;
    }

    if (!selectedModel) {
      toast.error("モデルを選択してください");
      return;
    }

    const currentPrompt = prompt;

    // Save to history
    saveToHistory(currentPrompt);

    // Save params for manual retry
    setLastPromptParams({
      prompt: currentPrompt,
      model: selectedModel,
      size,
      maxTokens,
      temperature,
      useCurrentColor,
    });

    // Clear prompt for next input
    setPrompt("");
    localStorage.setItem(PROMPT_STORAGE_KEY, "");

    // Reset stop flag
    shouldStopRef.current = false;

    // Create AbortController for cancellation
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setAiRawOutput("");
    setExtractedSVGs([]);
    setSelectedSVGIndex(0);
    setDebugLogs([]);
    setElapsedTime(0);
    addLog("info: Starting generation...");
    addLog(`info: Prompt: ${currentPrompt}`);
    addLog(`info: Model: ${selectedModel}`);
    addLog(`info: Size: ${size}px`);
    addLog(`info: currentColor: ${useCurrentColor ? "enabled" : "disabled"}`);

    const maxRetries = 10;
    let attempt = 0;
    let currentOutput = "";

    while (attempt < maxRetries) {
      // Check if user requested full stop
      if (shouldStopRef.current) {
        addLog("info: Generation stopped by user");
        abortControllerRef.current = null;
        shouldStopRef.current = false;
        return;
      }

      attempt++;
      if (attempt > 1) {
        addLog(`warning: Retry attempt ${attempt}/${maxRetries}`);
        addLog(
          `info: Resetting currentOutput (was ${currentOutput.length} chars)`,
        );
        currentOutput = "";
        setAiRawOutput("");
      }

      addLog(
        `info: Starting attempt ${attempt} with controller: ${abortControllerRef.current ? "valid" : "null"}`,
      );

      try {
        const fullResponse = await generateSVG({
          modelId: selectedModel,
          prompt: currentPrompt,
          size,
          maxTokens,
          temperature,
          useCurrentColor,
          abortSignal: abortControllerRef.current?.signal,
          onProgress: (info) => {
            addLog(
              `progress: ${Math.round(info.progress * 100)}% - ${info.text}`,
            );
          },
          onChunk: (chunk) => {
            if (!chunk) return;
            currentOutput += chunk;
            setAiRawOutput(currentOutput);

            // Extract all matching SVGs in real-time for preview
            const matches = currentOutput.match(/<svg[\s\S]*?<\/svg>/gi);
            if (matches && matches.length > 0) {
              // Filter valid SVGs
              const validSVGs = matches.filter((svg) => isSvg(svg));
              setExtractedSVGs(validSVGs);
              // 生成中は自動選択しない（ユーザーの選択を尊重）
            }
          },
          onGenerationStart: () => {
            // Start timer when AI generation actually begins
            addLog(`info: Generation stream started for attempt ${attempt}`);
            setStartTime(Date.now());
          },
          onGenerationEnd: () => {
            // Stop timer when AI generation completes
            addLog(`info: Generation stream ended for attempt ${attempt}`);
            setStartTime(null);
          },
        });
        addLog("success: AI generation completed");

        // SVGコードの抽出（複数対応）
        const svgMatches = fullResponse.match(/<svg[\s\S]*?<\/svg>/gi);

        if (!svgMatches || svgMatches.length === 0) {
          addLog("error: SVG tag not found in response");
          if (attempt < maxRetries) {
            addLog("info: Retrying...");
            setStartTime(null);
            continue;
          }
          toast.error("SVGコードを抽出できませんでした");
          setStartTime(null);
          return;
        }

        // 各SVGを検証
        const validSVGs: string[] = [];
        for (const svg of svgMatches) {
          // SVGの妥当性を検証
          if (!isSvg(svg)) {
            addLog(`warning: Invalid SVG format detected, skipping`);
            continue;
          }

          // SVGのサイズを検証（警告のみ）
          const viewBoxMatch = svg.match(/viewBox=["']([^"']+)["']/i);
          if (viewBoxMatch) {
            const viewBoxValues = viewBoxMatch[1].split(/\s+/);
            const svgWidth = Number.parseFloat(viewBoxValues[2]);
            const svgHeight = Number.parseFloat(viewBoxValues[3]);

            if (svgWidth !== size || svgHeight !== size) {
              addLog(
                `warning: Size mismatch in one SVG - expected ${size}x${size}, got ${svgWidth}x${svgHeight}`,
              );
            }
          }

          validSVGs.push(svg);
        }

        if (validSVGs.length === 0) {
          addLog("error: No valid SVG found");
          if (attempt < maxRetries) {
            addLog("info: Retrying...");
            setStartTime(null);
            continue;
          }
          toast.error("有効なSVGが見つかりませんでした");
          setStartTime(null);
          return;
        }

        addLog(
          `success: SVG validation passed (${validSVGs.length} SVG(s) found)`,
        );
        setExtractedSVGs(validSVGs);
        setSelectedSVGIndex(validSVGs.length - 1); // 最後のSVGを選択

        // モデルがキャッシュに追加されたことを反映
        setCachedModels((prev) => new Set(prev).add(selectedModel));

        setStartTime(null);
        abortControllerRef.current = null;
        toast.success(
          attempt > 1
            ? `${validSVGs.length}個のSVGを生成しました (試行 ${attempt})`
            : `${validSVGs.length}個のSVGを生成しました`,
        );
        return;
      } catch (error) {
        setStartTime(null);
        // Check if it was aborted by user
        if (
          error instanceof Error &&
          (error.name === "AbortError" || error.message.includes("Aborted"))
        ) {
          if (shouldStopRef.current) {
            // User clicked stop button - exit completely
            addLog("info: Generation stopped by user");
            abortControllerRef.current = null;
            shouldStopRef.current = false;
            return;
          } else {
            // User clicked retry button - create new controller and continue
            addLog("info: Skipping to next attempt...");
            const newController = new AbortController();
            abortControllerRef.current = newController;
            // Continue will go to next iteration with new controller
            continue;
          }
        }
        addLog(`error: Generation failed (attempt ${attempt}): ${error}`);
        if (attempt >= maxRetries) {
          setStartTime(null);
          abortControllerRef.current = null;
          toast.error(String(error));
          return;
        }
        addLog("info: Retrying...");
      }
    }

    setStartTime(null);
    toast.error("Maximum retry attempts reached");
    abortControllerRef.current = null;
  };

  const handleStop = async () => {
    if (abortControllerRef.current) {
      shouldStopRef.current = true;
      addLog("info: Stop requested by user");
      // Use WebLLM's official interrupt API
      await interruptGenerate();
      abortControllerRef.current = null;
      setStartTime(null);
      toast.info("生成を中止しました");
    }
  };

  const handleRetry = async () => {
    if (abortControllerRef.current) {
      // Use WebLLM's official interrupt API instead of abort
      addLog("info: Skipping to next retry attempt...");
      await interruptGenerate();
      toast.info("次の試行に進みます...");
    }
  };

  const handleDownload = () => {
    const svg = extractedSVGs[selectedSVGIndex];
    if (!svg) return;

    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ai-generated-icon-${selectedSVGIndex + 1}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast.success("SVGをダウンロードしました");
  };

  const handleCopy = () => {
    const svg = extractedSVGs[selectedSVGIndex];
    if (!svg) return;

    navigator.clipboard.writeText(svg);
    toast.success("SVGコードをコピーしました");
  };

  const handleDownloadAll = () => {
    if (extractedSVGs.length === 0) return;

    extractedSVGs.forEach((svg, index) => {
      const blob = new Blob([svg], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ai-generated-icon-${index + 1}.svg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });

    toast.success(`${extractedSVGs.length}個のSVGをダウンロードしました`);
  };

  const handleDeleteCache = async (modelId: string) => {
    try {
      await deleteModelCache(modelId);
      setCachedModels((prev) => {
        const newSet = new Set(prev);
        newSet.delete(modelId);
        return newSet;
      });
      addLog(`success: Cache deleted for model: ${modelId}`);
      toast.success("モデルキャッシュを削除しました");
    } catch (error) {
      addLog(`error: Failed to delete cache: ${error}`);
      toast.error("キャッシュの削除に失敗しました");
    }
  };

  const handleDeleteAllCache = async () => {
    try {
      await deleteAllModelCache();
      setCachedModels(new Set());
      addLog(
        "success: All caches deleted (IndexedDB, Cache Storage, LocalStorage, SessionStorage, Service Workers)",
      );
      toast.success("すべてのキャッシュを削除しました");
    } catch (error) {
      addLog(`error: Failed to delete all cache: ${error}`);
      toast.error("キャッシュの削除に失敗しました");
    }
  };

  const handleModelChange = useCallback(
    (value: string) => {
      setSelectedModel(value);
      localStorage.setItem(MODEL_STORAGE_KEY, value);
      resetEngine();
      addLog(`info: Model changed to: ${value}`);
    },
    [resetEngine, addLog],
  );

  const handleDeleteCacheMemo = useCallback(handleDeleteCache, [
    deleteModelCache,
    addLog,
  ]);

  return (
    <div className="min-h-screen flex flex-col">
      <AppNavbar />

      <div className="flex-1 container mx-auto py-8 px-4 max-w-7xl">
        <div className="space-y-6">
          <Card className="p-6">
            <div className="space-y-6">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="prompt">SVGアイコンの詳細な説明</Label>
                  <Dialog
                    open={isHistoryModalOpen}
                    onOpenChange={setIsHistoryModalOpen}
                  >
                    <DialogTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-7">
                        <History className="h-4 w-4 mr-1" />
                        履歴 ({promptHistory.length})
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
                      <DialogHeader>
                        <DialogTitle>プロンプト履歴</DialogTitle>
                        <DialogDescription>
                          過去のプロンプトを選択して再利用できます
                        </DialogDescription>
                      </DialogHeader>
                      <div className="flex-1 overflow-auto space-y-2 pr-2">
                        {promptHistory.length === 0 ? (
                          <p className="text-sm text-muted-foreground text-center py-8">
                            履歴はありません
                          </p>
                        ) : (
                          promptHistory.map((historyPrompt, index) => (
                            <Card
                              key={index}
                              className="p-3 hover:bg-muted/50 cursor-pointer transition-colors"
                            >
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setPrompt(historyPrompt);
                                    setIsHistoryModalOpen(false);
                                    toast.success("履歴を適用しました");
                                  }}
                                  className="flex-1 text-left"
                                >
                                  <div className="flex items-start gap-2">
                                    <Clock className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                                    <p className="text-sm break-words">
                                      {historyPrompt}
                                    </p>
                                  </div>
                                </button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 flex-shrink-0"
                                  onClick={() => deleteHistoryItem(index)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </Card>
                          ))
                        )}
                      </div>
                      {promptHistory.length > 0 && (
                        <div className="pt-4 border-t">
                          <Button
                            variant="outline"
                            onClick={clearHistory}
                            className="w-full"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            すべての履歴を削除
                          </Button>
                        </div>
                      )}
                    </DialogContent>
                  </Dialog>
                </div>
                <Textarea
                  ref={textareaRef}
                  id="prompt"
                  value={prompt}
                  onChange={(e) => {
                    const newPrompt = e.target.value;
                    setPrompt(newPrompt);
                    localStorage.setItem(PROMPT_STORAGE_KEY, newPrompt);
                  }}
                  onKeyDown={handlePromptKeyDown}
                  placeholder="シンプルな家のアイコン、線画スタイル、正方形の土台に三角形の屋根 (↑1行目で↑キーで履歴)"
                  rows={4}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-7">
                <ModelSelector
                  models={models}
                  cachedModels={cachedModels}
                  selectedModel={selectedModel}
                  onModelChange={handleModelChange}
                  onDeleteCache={handleDeleteCacheMemo}
                  isInitializing={isInitializing}
                  isGenerating={isGenerating}
                />

                <div className="space-y-2">
                  <Label htmlFor="size">サイズ</Label>
                  <Input
                    id="size"
                    type="number"
                    value={size}
                    onChange={(e) => setSize(Number(e.target.value))}
                    min={32}
                    max={512}
                    step={16}
                    className="w-full"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="maxTokens">トークン</Label>
                  <Input
                    id="maxTokens"
                    type="number"
                    value={maxTokens}
                    onChange={(e) => setMaxTokens(Number(e.target.value))}
                    min={100}
                    max={2000}
                    step={100}
                    className="w-full"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="temperature">Temp</Label>
                  <Input
                    id="temperature"
                    type="number"
                    value={temperature}
                    onChange={(e) => setTemperature(Number(e.target.value))}
                    min={0}
                    max={2}
                    step={0.1}
                    className="w-full"
                  />
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  id="currentColor"
                  checked={useCurrentColor}
                  onCheckedChange={setUseCurrentColor}
                />
                <Label htmlFor="currentColor" className="cursor-pointer">
                  currentColor を使用する
                </Label>
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={handleGenerate}
                  disabled={isInitializing || isGenerating}
                  className="flex-1"
                  size="lg"
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  {isGenerating ? "生成中..." : "SVGを生成"}
                </Button>
                {(isInitializing || isGenerating) && (
                  <Button
                    onClick={handleRetry}
                    variant="outline"
                    size="lg"
                    title="現在の試行をスキップして次の試行へ"
                  >
                    リトライ
                  </Button>
                )}
                {(isInitializing || isGenerating) && (
                  <Button onClick={handleStop} variant="destructive" size="lg">
                    停止
                  </Button>
                )}
                <Button
                  onClick={handleDeleteAllCache}
                  disabled={isInitializing || isGenerating}
                  variant="outline"
                  size="lg"
                  title="すべてのモデルキャッシュを削除"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </Card>

          <StatusDisplay
            statusText={statusText}
            startTime={startTime}
            elapsedTime={elapsedTime}
            isInitializing={isInitializing}
            isGenerating={isGenerating}
            progress={progress}
          />

          <Tabs defaultValue="preview" className="h-[650px] flex flex-col">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="preview">プレビュー</TabsTrigger>
              <TabsTrigger value="svg">SVGコード</TabsTrigger>
              <TabsTrigger value="raw">AI生成テキスト</TabsTrigger>
              <TabsTrigger value="logs">デバッグログ</TabsTrigger>
            </TabsList>

            <TabsContent
              value="preview"
              className="flex-1 mt-4 overflow-hidden"
            >
              <Card className="p-8 h-full flex flex-col">
                {extractedSVGs.length > 0 ? (
                  <div className="space-y-4 h-full flex flex-col">
                    {extractedSVGs.length > 1 && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-muted-foreground">
                          {extractedSVGs.length}個のSVG:
                        </span>
                        {extractedSVGs.map((_, index) => (
                          <Button
                            key={index}
                            onClick={() => setSelectedSVGIndex(index)}
                            variant={
                              selectedSVGIndex === index ? "default" : "outline"
                            }
                            size="sm"
                          >
                            #{index + 1}
                          </Button>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center justify-center flex-1 bg-muted/30 rounded-lg p-8 overflow-auto">
                      <div
                        className="[&>svg]:max-w-full [&>svg]:max-h-full [&>svg]:w-auto [&>svg]:h-auto"
                        dangerouslySetInnerHTML={{
                          __html: extractedSVGs[selectedSVGIndex],
                        }}
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        onClick={handleDownload}
                        variant="outline"
                        className="flex-1"
                      >
                        <Download className="mr-2 h-4 w-4" />#
                        {selectedSVGIndex + 1} をダウンロード
                      </Button>
                      <Button
                        onClick={handleCopy}
                        variant="outline"
                        className="flex-1"
                      >
                        <Copy className="mr-2 h-4 w-4" />#{selectedSVGIndex + 1}{" "}
                        をコピー
                      </Button>
                      {extractedSVGs.length > 1 && (
                        <Button
                          onClick={handleDownloadAll}
                          variant="outline"
                          className="flex-1"
                        >
                          <Download className="mr-2 h-4 w-4" />
                          すべてダウンロード
                        </Button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    SVGを生成してプレビューを表示
                  </div>
                )}
              </Card>
            </TabsContent>

            <TabsContent value="svg" className="flex-1 mt-4 overflow-hidden">
              <Card className="p-6 h-full flex flex-col">
                {extractedSVGs.length > 1 && (
                  <div className="flex items-center gap-2 flex-wrap mb-4">
                    <span className="text-sm text-muted-foreground">
                      {extractedSVGs.length}個のSVG:
                    </span>
                    {extractedSVGs.map((_, index) => (
                      <Button
                        key={index}
                        onClick={() => setSelectedSVGIndex(index)}
                        variant={
                          selectedSVGIndex === index ? "default" : "outline"
                        }
                        size="sm"
                      >
                        #{index + 1}
                      </Button>
                    ))}
                  </div>
                )}
                <CodeBlock
                  data={[
                    {
                      language: "xml",
                      code: extractedSVGs[selectedSVGIndex] || "",
                    },
                  ]}
                  defaultValue="xml"
                  className="flex-1 flex flex-col overflow-hidden"
                >
                  <CodeBlockHeader>
                    <div className="flex-1 px-2 text-sm text-muted-foreground">
                      SVG Code{" "}
                      {extractedSVGs.length > 1 && `(#${selectedSVGIndex + 1})`}
                    </div>
                    <CodeBlockCopyButton />
                  </CodeBlockHeader>
                  <CodeBlockBody className="flex-1 overflow-hidden">
                    {(item) => (
                      <CodeBlockItem
                        key={item.language}
                        value={item.language}
                        lineNumbers={true}
                        className="h-full overflow-auto pl-4 [&_code]:!overflow-visible [&_code]:!grid [&_code]:!h-auto [&_.line]:!whitespace-pre-wrap [&_.line]:!break-all [&_.line]:!pl-8 [&_.line]:!indent-[-2rem]"
                      >
                        <CodeBlockContent language="xml">
                          {item.code}
                        </CodeBlockContent>
                      </CodeBlockItem>
                    )}
                  </CodeBlockBody>
                </CodeBlock>
              </Card>
            </TabsContent>

            <TabsContent value="raw" className="flex-1 mt-4 overflow-hidden">
              <Card className="p-6 h-full flex flex-col">
                <CodeBlock
                  data={[
                    {
                      language: "xml",
                      code: aiRawOutput || "",
                    },
                  ]}
                  defaultValue="xml"
                  className="flex-1 flex flex-col overflow-hidden"
                >
                  <CodeBlockHeader>
                    <div className="flex-1 px-2 text-sm text-muted-foreground">
                      AI Output
                    </div>
                    <div className="flex items-center gap-2 mr-2">
                      <Switch
                        id="autoScrollRaw"
                        checked={autoScrollRaw}
                        onCheckedChange={setAutoScrollRaw}
                      />
                      <Label
                        htmlFor="autoScrollRaw"
                        className="cursor-pointer text-sm"
                      >
                        Auto-scroll
                      </Label>
                    </div>
                    <CodeBlockCopyButton />
                  </CodeBlockHeader>
                  <CodeBlockBody className="flex-1 overflow-hidden">
                    {(item) => (
                      <div
                        key={item.language}
                        ref={aiOutputRef}
                        className="h-full"
                      >
                        <CodeBlockItem
                          value={item.language}
                          lineNumbers={true}
                          className="h-full overflow-auto pl-4 [&_code]:!overflow-visible [&_code]:!grid [&_code]:!h-auto [&_.line]:!whitespace-pre-wrap [&_.line]:!break-all [&_.line]:!pl-8 [&_.line]:!indent-[-2rem]"
                        >
                          <CodeBlockContent language="xml">
                            {item.code}
                          </CodeBlockContent>
                        </CodeBlockItem>
                      </div>
                    )}
                  </CodeBlockBody>
                </CodeBlock>
              </Card>
            </TabsContent>

            <TabsContent value="logs" className="flex-1 mt-4 overflow-hidden">
              <Card className="p-6 h-full flex flex-col">
                <div className="space-y-4 flex flex-col h-full">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">Debug Logs</div>
                    <div className="flex items-center gap-2">
                      <Switch
                        id="autoScroll"
                        checked={autoScroll}
                        onCheckedChange={setAutoScroll}
                      />
                      <Label
                        htmlFor="autoScroll"
                        className="cursor-pointer text-sm"
                      >
                        Auto-scroll
                      </Label>
                    </div>
                  </div>
                  <div
                    className="rounded-lg border p-4 overflow-y-auto font-mono text-sm bg-muted/30 flex-1"
                    ref={(el) => {
                      if (el && autoScroll && debugLogs.length > 0) {
                        el.scrollTop = el.scrollHeight;
                      }
                    }}
                  >
                    {debugLogs.length === 0 ? (
                      <div className="text-muted-foreground">No logs yet</div>
                    ) : (
                      debugLogs.map((log, index) => {
                        const timestampMatch = log.match(/^\[([^\]]+)\] (.+)$/);
                        if (!timestampMatch)
                          return (
                            <div key={index} className="text-foreground">
                              {log}
                            </div>
                          );

                        const [, timestamp, message] = timestampMatch;
                        let textColor = "text-foreground";
                        let prefix = "";

                        if (message.startsWith("error:")) {
                          textColor = "text-red-600 dark:text-red-400";
                          prefix = "✗";
                        } else if (message.startsWith("success:")) {
                          textColor = "text-green-600 dark:text-green-400";
                          prefix = "✓";
                        } else if (message.startsWith("warning:")) {
                          textColor = "text-yellow-600 dark:text-yellow-400";
                          prefix = "⚠";
                        } else if (message.startsWith("progress:")) {
                          textColor = "text-cyan-600 dark:text-cyan-400";
                          prefix = "●";
                        } else if (message.startsWith("info:")) {
                          textColor = "text-blue-600 dark:text-blue-400";
                          prefix = "ℹ";
                        }

                        const cleanMessage = message.replace(
                          /^(error|success|warning|progress|info):\s*/,
                          "",
                        );

                        return (
                          <div key={index} className="py-0.5">
                            <span className="text-muted-foreground">
                              [{timestamp}]
                            </span>{" "}
                            {prefix && (
                              <span className={textColor}>{prefix}</span>
                            )}{" "}
                            <span className={textColor}>{cleanMessage}</span>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
