import { useState, useCallback, useRef, useEffect } from "react";
import { toast } from "sonner";
import { ChevronRight, DownloadCloud, RefreshCw, Clock, Upload, X, Trash2 } from "lucide-react";
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import { Progress } from "@/components/ui/progress";
import JSZip from 'jszip';

interface VideoClip {
  id: string;
  name: string;
  duration: number;
  type: "hook" | "selling-point" | "cta";
  file?: File;
}

interface Sequence {
  id: string;
  clips: VideoClip[];
  duration: number;
}

const Index = () => {
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [loading, setLoading] = useState(false);
  const [ffmpegLoading, setFfmpegLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [availableClips, setAvailableClips] = useState<VideoClip[]>([]);
  const [ffmpeg, setFFmpeg] = useState<FFmpeg | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const initFFmpeg = async () => {
      try {
        setFfmpegLoading(true);
        setLoadingProgress(0);
        const ffmpegInstance = new FFmpeg();
        
        ffmpegInstance.on('log', ({ message }) => {
          console.log('FFmpeg log:', message);
          if (message.includes('loading')) {
            setLoadingProgress(25);
          } else if (message.includes('loaded')) {
            setLoadingProgress(50);
          } else if (message.includes('initialized')) {
            setLoadingProgress(75);
          }
        });

        await ffmpegInstance.load();
        setFFmpeg(ffmpegInstance);
        setLoadingProgress(100);
        setFfmpegLoading(false);
        toast.success('Video processing initialized');
      } catch (error) {
        console.error('Error initializing FFmpeg:', error);
        toast.error('Failed to initialize video processing');
        setFfmpegLoading(false);
      }
    };

    initFFmpeg();
  }, []);

  const detectClipType = (filename: string): VideoClip['type'] => {
    const lowercaseFilename = filename.toLowerCase();
    
    if (lowercaseFilename.includes('hook')) {
      return 'hook';
    }
    if (lowercaseFilename.includes('cta') || lowercaseFilename.includes('call to action')) {
      return 'cta';
    }
    if (lowercaseFilename.includes('selling point') || lowercaseFilename.includes('sp')) {
      return 'selling-point';
    }
    
    return 'selling-point'; // default type
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (ffmpegLoading || !ffmpeg) {
      toast.error('Please wait for video processing to initialize');
      return;
    }

    const files = event.target.files;
    if (!files) return;

    for (const file of Array.from(files)) {
      try {
        let processedFile = file;
        
        // Convert MOV to MP4 if necessary
        if (file.name.toLowerCase().endsWith('.mov')) {
          toast.info(`Converting ${file.name} to MP4...`);
          
          // Write the MOV file to FFmpeg's virtual filesystem
          const inputData = await fetchFile(file);
          await ffmpeg.writeFile('input.mov', inputData);
          
          // Convert MOV to MP4
          await ffmpeg.exec([
            '-i', 'input.mov',
            '-c:v', 'copy',
            '-c:a', 'aac',
            'output.mp4'
          ]);
          
          // Read the converted file
          const outputData = await ffmpeg.readFile('output.mp4');
          const outputBlob = new Blob([outputData], { type: 'video/mp4' });
          processedFile = new File([outputBlob], file.name.replace('.mov', '.mp4'), { type: 'video/mp4' });
          
          // Clean up temporary files
          await ffmpeg.deleteFile('input.mov');
          await ffmpeg.deleteFile('output.mp4');
          
          toast.success(`Converted ${file.name} to MP4`);
        }

        const video = document.createElement('video');
        video.preload = 'metadata';

        const promise = new Promise<number>((resolve) => {
          video.onloadedmetadata = () => {
            resolve(video.duration);
            URL.revokeObjectURL(video.src);
          };
        });

        video.src = URL.createObjectURL(processedFile);
        const duration = await promise;

        const detectedType = detectClipType(processedFile.name);

        const newClip: VideoClip = {
          id: `clip-${Date.now()}-${Math.random()}`,
          name: processedFile.name.split('.')[0],
          duration,
          type: detectedType,
          file: processedFile
        };

        setAvailableClips(prev => [...prev, newClip]);
        toast.success(`Uploaded ${processedFile.name} as ${detectedType}`);
      } catch (error) {
        console.error('Error processing file:', error);
        toast.error(`Failed to process ${file.name}`);
      }
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const updateClipType = (clipId: string, newType: VideoClip['type']) => {
    setAvailableClips(prev =>
      prev.map(clip =>
        clip.id === clipId ? { ...clip, type: newType } : clip
      )
    );
  };

  const removeClip = (clipId: string) => {
    setAvailableClips(prev => prev.filter(clip => clip.id !== clipId));
    toast.success("Clip removed");
  };

  const removeAllClips = () => {
    setAvailableClips([]);
    toast.success("All clips removed");
  };

  const deleteSequence = (sequenceId: string) => {
    setSequences(prev => prev.filter(seq => seq.id !== sequenceId));
    toast.success("Sequence removed");
  };

  const generateSequences = useCallback(() => {
    if (availableClips.length === 0) {
      toast.error("Please upload some video clips first");
      return;
    }

    const hooks = availableClips.filter(clip => clip.type === "hook");
    const sellingPoints = availableClips.filter(clip => clip.type === "selling-point");
    const ctas = availableClips.filter(clip => clip.type === "cta");

    if (hooks.length === 0 || ctas.length === 0) {
      toast.error("You need at least one hook and one CTA clip");
      return;
    }

    setLoading(true);
    
    const newSequences: Sequence[] = [];
    const usedCombinations = new Set<string>();
    const maxAttempts = 100; // Prevent infinite loops
    let attempts = 0;

    // Calculate maximum possible unique combinations
    const maxSellingPoints = Math.min(3, sellingPoints.length);
    const maxCombinations = hooks.length * ctas.length * (
      // Sum of combinations for 1 to maxSellingPoints
      Array.from({length: maxSellingPoints}, (_, i) => 
        binomialCoefficient(sellingPoints.length, i + 1)
      ).reduce((a, b) => a + b, 0)
    );
    
    const targetSequences = Math.min(10, maxCombinations);
    
    while (newSequences.length < targetSequences && attempts < maxAttempts) {
      attempts++;
      const selectedHook = hooks[Math.floor(Math.random() * hooks.length)];
      const selectedCTA = ctas[Math.floor(Math.random() * ctas.length)];
      
      const numSellingPoints = Math.min(
        Math.floor(Math.random() * maxSellingPoints) + 1,
        sellingPoints.length
      );
      
      // Use Fisher-Yates shuffle for better randomization
      const shuffledIndices = Array.from({length: sellingPoints.length}, (_, i) => i);
      for (let i = shuffledIndices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledIndices[i], shuffledIndices[j]] = [shuffledIndices[j], shuffledIndices[i]];
      }
      
      const selectedSellingPoints = shuffledIndices
        .slice(0, numSellingPoints)
        .map(index => sellingPoints[index]);
      
      const combinationKey = [
        selectedHook.id,
        ...selectedSellingPoints.map(sp => sp.id).sort(),
        selectedCTA.id
      ].join('|');
      
      if (!usedCombinations.has(combinationKey)) {
        usedCombinations.add(combinationKey);
        
        const sequenceClips = [
          selectedHook,
          ...selectedSellingPoints,
          selectedCTA
        ];
        
        const totalDuration = sequenceClips.reduce((acc, clip) => acc + clip.duration, 0);
        
        newSequences.push({
          id: `sequence-${newSequences.length + 1}`,
          clips: sequenceClips,
          duration: totalDuration
        });
      }
    }
    
    setSequences(newSequences);
    setLoading(false);
    toast.success(`Generated ${newSequences.length} unique sequences!`);
  }, [availableClips]);

  const exportSequence = useCallback(async (sequence: Sequence, index?: number) => {
    if (ffmpegLoading || !ffmpeg) {
      toast.error('Please wait for video processing to initialize');
      return;
    }

    try {
      setLoading(true);
      if (!index) toast.success("Starting export...");

      let listFileContent = '';
      
      for (let i = 0; i < sequence.clips.length; i++) {
        const clip = sequence.clips[i];
        if (!clip.file) {
          throw new Error(`Missing file for clip: ${clip.name}`);
        }

        const inputData = await fetchFile(clip.file);
        await ffmpeg.writeFile(`input${i}.mp4`, inputData);
        
        listFileContent += `file input${i}.mp4\n`;
      }

      await ffmpeg.writeFile('list.txt', listFileContent);

      await ffmpeg.exec([
        '-f', 'concat',
        '-safe', '0',
        '-i', 'list.txt',
        '-c', 'copy',
        'output.mp4'
      ]);

      const outputData = await ffmpeg.readFile('output.mp4');
      
      if (index !== undefined) {
        return {
          name: `restitched ${index + 1}.mp4`,
          data: outputData
        };
      } else {
        const blob = new Blob([outputData], { type: 'video/mp4' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `restitched ${sequence.id}.mp4`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }

      for (let i = 0; i < sequence.clips.length; i++) {
        await ffmpeg.deleteFile(`input${i}.mp4`);
      }
      await ffmpeg.deleteFile('list.txt');
      await ffmpeg.deleteFile('output.mp4');

      if (!index) toast.success("Export completed!");
    } catch (error) {
      console.error('Export error:', error);
      if (!index) toast.error("Failed to export sequence");
      throw error;
    } finally {
      if (!index) setLoading(false);
    }
  }, [ffmpeg, ffmpegLoading]);

  const downloadAllSequences = async () => {
    if (ffmpegLoading || !ffmpeg || sequences.length === 0) {
      toast.error('No sequences to download or processing not ready');
      return;
    }

    setLoading(true);
    toast.success("Starting batch download...");

    try {
      const zip = new JSZip();
      
      for (let i = 0; i < sequences.length; i++) {
        const result = await exportSequence(sequences[i], i);
        if (result) {
          zip.file(`restitched ${i + 1}.mp4`, result.data);
        }
      }

      const zipContent = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipContent);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'restitched-sequences.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success("All sequences downloaded!");
    } catch (error) {
      console.error('Batch download error:', error);
      toast.error("Failed to download all sequences");
    } finally {
      setLoading(false);
    }
  };

  const binomialCoefficient = (n: number, k: number): number => {
    if (k > n) return 0;
    if (k === 0 || k === n) return 1;
    
    let result = 1;
    for (let i = 1; i <= k; i++) {
      result *= (n + 1 - i) / i;
    }
    return Math.floor(result);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12 animate-fade-up">
          <h1 className="text-4xl font-bold mb-4 text-gray-900">Video Sequence Generator</h1>
          <p className="text-gray-600 mb-8">Create engaging video sequences from your content clips</p>
          
          {ffmpegLoading && (
            <div className="max-w-md mx-auto mb-8">
              <Progress value={loadingProgress} className="h-2" />
              <p className="text-sm text-gray-500 mt-2">Initializing... {loadingProgress}%</p>
            </div>
          )}
          
          <div className="mb-8">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept="video/*"
              multiple
              className="hidden"
              disabled={ffmpegLoading}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center px-6 py-3 bg-gray-100 text-gray-900 rounded-lg shadow-sm hover:bg-gray-200 transition-colors mr-4 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={ffmpegLoading}
            >
              {ffmpegLoading ? (
                <RefreshCw className="w-5 h-5 mr-2 animate-spin" />
              ) : (
                <Upload className="w-5 h-5 mr-2" />
              )}
              {ffmpegLoading ? 'Initializing...' : 'Upload Videos'}
            </button>
            
            <button
              onClick={generateSequences}
              disabled={loading || ffmpegLoading}
              className="inline-flex items-center px-6 py-3 bg-black text-white rounded-lg shadow-sm hover:bg-gray-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed mr-4"
            >
              {loading ? (
                <RefreshCw className="w-5 h-5 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-5 h-5 mr-2" />
              )}
              Generate Sequences
            </button>

            {sequences.length > 0 && (
              <button
                onClick={downloadAllSequences}
                disabled={loading || ffmpegLoading}
                className="inline-flex items-center px-6 py-3 bg-blue-500 text-white rounded-lg shadow-sm hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <DownloadCloud className="w-5 h-5 mr-2" />
                Download All
              </button>
            )}
          </div>

          {availableClips.length > 0 && (
            <div className="bg-white rounded-xl p-6 shadow-sm mb-8">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-semibold">Uploaded Clips</h2>
                <button
                  onClick={removeAllClips}
                  className="text-sm px-3 py-1 text-red-600 hover:bg-red-50 rounded-md transition-colors"
                >
                  Delete All
                </button>
              </div>
              <div className="grid gap-4">
                {availableClips.map((clip) => (
                  <div key={clip.id} className="flex items-center justify-between bg-gray-50 p-4 rounded-lg">
                    <div className="flex items-center space-x-4">
                      <span className="text-sm font-medium">{clip.name}</span>
                      <span className="text-sm text-gray-500">({clip.duration.toFixed(1)}s)</span>
                    </div>
                    <div className="flex items-center space-x-4">
                      <select
                        value={clip.type}
                        onChange={(e) => updateClipType(clip.id, e.target.value as VideoClip['type'])}
                        className="text-sm rounded-md border-gray-300 py-1"
                      >
                        <option value="hook">Hook</option>
                        <option value="selling-point">Selling Point</option>
                        <option value="cta">CTA</option>
                      </select>
                      <button
                        onClick={() => removeClip(clip.id)}
                        className="text-gray-500 hover:text-red-500 transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="grid gap-6 animate-fade-in">
          {sequences.map((sequence) => (
            <div
              key={sequence.id}
              className="bg-white rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow border border-gray-100"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-4">
                  <div className="flex items-center space-x-2">
                    <Clock className="w-5 h-5 text-gray-400" />
                    <span className="text-sm text-gray-600">
                      {sequence.duration.toFixed(1)}s
                    </span>
                  </div>
                  <button
                    onClick={() => deleteSequence(sequence.id)}
                    className="text-gray-400 hover:text-red-500 transition-colors"
                    title="Delete sequence"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
                <button
                  onClick={() => exportSequence(sequence)}
                  className="inline-flex items-center px-4 py-2 text-sm bg-gray-100 text-gray-900 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  <DownloadCloud className="w-4 h-4 mr-2" />
                  Export
                </button>
              </div>
              
              <div className="flex items-center space-x-2">
                {sequence.clips.map((clip, index) => (
                  <div key={clip.id} className="flex items-center">
                    <div
                      className={`px-3 py-2 rounded-lg text-sm ${
                        clip.type === "hook"
                          ? "bg-rose-100 text-rose-700"
                          : clip.type === "selling-point"
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-violet-100 text-violet-700"
                      }`}
                    >
                      {clip.name}
                    </div>
                    {index < sequence.clips.length - 1 && (
                      <ChevronRight className="w-4 h-4 mx-2 text-gray-400" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Index;
