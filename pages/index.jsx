import { useState, useEffect, useRef } from 'react';
import { Container, Row, Col, Card, Button, Badge, Alert, Spinner, ProgressBar, Toast, ToastContainer } from 'react-bootstrap';

export default function Home() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState([]);
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState('');
  const [error, setError] = useState(null);
  const [showToast, setShowToast] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [analysisTime, setAnalysisTime] = useState(0);
  const evtSrcRef = useRef(null);
  const logsEndRef = useRef(null);
  const retryCountRef = useRef(0);
  const startTimeRef = useRef(null);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Real-time timer
  useEffect(() => {
    let interval = null;
    if (loading && startTimeRef.current) {
      interval = setInterval(() => {
        setAnalysisTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    } else {
      setAnalysisTime(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [loading]);

  function handleFile(e) {
    const f = e.target.files[0];
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setResult(null);
    setLogs([]);
    setError(null);
    setProgress(0);
    setCurrentStep('');
    setConnectionStatus('disconnected');
    retryCountRef.current = 0;
    setAnalysisTime(0);
  }

  function addLog(message) {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, `[${timestamp}] ${message}`]);
  }

  function updateProgress(message) {
    if (message.includes('Upload')) setProgress(15);
    else if (message.includes('Connection') || message.includes('Connected')) setProgress(20);
    else if (message.includes('Processing') || message.includes('Reading')) setProgress(30);
    else if (message.includes('Calling') || message.includes('vision')) setProgress(40);
    else if (message.includes('Vision analysis received')) setProgress(60);
    else if (message.includes('Creating embedding')) setProgress(70);
    else if (message.includes('Formatting')) setProgress(85);
    else if (message.includes('complete')) setProgress(100);
    else if (progress < 95) setProgress(prev => Math.min(prev + 5, 95));
  }

  async function analyzeRealtime() {
    if (!file) {
      setError('Please choose an image first');
      return;
    }

    setLoading(true);
    setResult(null);
    setLogs([]);
    setError(null);
    setProgress(0);
    setCurrentStep('Initializing...');
    setConnectionStatus('connecting');
    retryCountRef.current = 0;
    startTimeRef.current = Date.now();

    try {
      setProgress(5);
      setCurrentStep('Uploading image...');
      addLog('📤 Uploading image to server...');
      
    const uploadForm = new FormData();
    uploadForm.append('image', file);
      
      const uploadRes = await fetch('/api/upload-temp', { 
        method: 'POST', 
        body: uploadForm 
      });

      if (!uploadRes.ok) {
        throw new Error('Upload failed: ' + uploadRes.statusText);
      }

    const uploadJson = await uploadRes.json();
      
      if (!uploadJson || !uploadJson.ok || !uploadJson.id) {
        throw new Error('Invalid upload response');
      }

    const uploadId = uploadJson.id;
      setProgress(10);
      addLog('✅ Image uploaded successfully (ID: ' + uploadId.substring(0, 8) + '...)');
      setCurrentStep('Connecting to analysis server...');

    if (evtSrcRef.current) {
      evtSrcRef.current.close();
      evtSrcRef.current = null;
    }

      setConnectionStatus('connecting');
      addLog('🔌 Establishing real-time connection...');
      
      const streamUrl = `/api/analyze-stream?id=${encodeURIComponent(uploadId)}`;
      const es = new EventSource(streamUrl);
    evtSrcRef.current = es;

      es.onopen = () => {
        setConnectionStatus('connected');
        addLog('✅ Connected! Starting analysis...');
        setProgress(15);
      };

      es.addEventListener('progress', (e) => {
        try {
          const data = JSON.parse(e.data);
          const msg = data.msg || data.message || 'Processing...';
          addLog('🔄 ' + msg);
          setCurrentStep(msg);
          updateProgress(msg);
        } catch (err) {
          addLog('🔄 ' + e.data);
        }
      });

      es.addEventListener('partial', (e) => {
        try {
          const data = JSON.parse(e.data);
          const text = data.text || data.message || '';
          if (text) {
            addLog('📝 Partial result received...');
            setResult(prev => ({
              ...prev,
              explanation_partial: text,
              imageSummary: prev?.imageSummary || text.substring(0, 200)
            }));
          }
        } catch (err) {
          console.error('Error parsing partial:', err);
        }
      });

      es.addEventListener('done', (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.result) {
            setResult(data.result);
            if (data.result.imageDataUrl && !preview) {
              setPreview(data.result.imageDataUrl);
            }
            setProgress(100);
            setCurrentStep('Analysis complete!');
            addLog('✅ Analysis complete!');
            if (data.result.isMockData) {
              addLog('ℹ️ Using mock data. Add OPENAI_API_KEY for real analysis.');
            }
            setShowToast(true);
            setConnectionStatus('disconnected');
            loadAnalyses();
            loadStats();
          }
        } catch (err) {
          setError('Error parsing result: ' + err.message);
        } finally {
          setLoading(false);
          if (es) {
          es.close();
            setConnectionStatus('disconnected');
          }
        }
      });

      es.addEventListener('error', (e) => {
        try {
          if (e.data) {
            const data = JSON.parse(e.data);
            const errorMsg = data.error || data.message || 'Server error occurred';
            setError('Analysis error: ' + errorMsg);
            addLog('❌ Error: ' + errorMsg);
            setLoading(false);
            setConnectionStatus('disconnected');
            if (es) es.close();
        }
      } catch (err) {
          const errorMsg = e.data ? (e.data.substring(0, 100) + '...') : 'Unknown error';
          setError('Error: ' + errorMsg);
          addLog('❌ Error: ' + errorMsg);
          setLoading(false);
          setConnectionStatus('disconnected');
          if (es) es.close();
        }
      });

    es.onerror = (err) => {
        if (es.readyState === EventSource.CLOSED) {
          if (!result) {
            if (retryCountRef.current < 1) {
              retryCountRef.current++;
              addLog(`🔄 Connection closed. Retrying... (${retryCountRef.current}/1)`);
              setTimeout(() => {
                if (!result && evtSrcRef.current) {
                  evtSrcRef.current.close();
                  evtSrcRef.current = null;
                  analyzeRealtime();
                }
              }, 3000);
            } else {
              setConnectionStatus('disconnected');
              setError('Connection failed. Please try "Analyze (Quick)" instead.');
              setLoading(false);
              addLog('❌ Connection failed after retries');
              if (es) es.close();
            }
          }
        }
      };
    } catch (err) {
      console.error('Analysis error:', err);
      setError('Analysis failed: ' + err.message);
      addLog('❌ Error: ' + err.message);
      setLoading(false);
      setConnectionStatus('disconnected');
    }
  }

  async function analyze() {
    if (!file) {
      setError('Please choose an image first');
      return;
    }
    setLoading(true);
    setLogs([]);
    setError(null);
    setProgress(10);
    setCurrentStep('Uploading and analyzing...');
    startTimeRef.current = Date.now();
    addLog('🚀 Starting analysis...');
    
    try {
    const form = new FormData();
    form.append('image', file);
      setProgress(30);
      addLog('📤 Uploading image...');
      
    const res = await fetch('/api/analyze', { method: 'POST', body: form });
      setProgress(70);
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: 'Analysis failed' }));
        throw new Error(errorData.error || 'Analysis failed');
      }
      
    const data = await res.json();
      setProgress(90);
      addLog('✅ Analysis received');
      
      if (data) {
    setResult(data);
        if (data.imageDataUrl && !preview) {
          setPreview(data.imageDataUrl);
        }
        setProgress(100);
        setCurrentStep('Analysis complete!');
        addLog('✅ Analysis complete!');
        if (data.isMockData) {
          addLog('ℹ️ Using mock data. Add OPENAI_API_KEY for real analysis.');
        }
        setShowToast(true);
        loadAnalyses();
        loadStats();
      } else {
        throw new Error('No data received');
      }
    } catch (err) {
      setError('Analysis failed: ' + err.message);
      addLog('❌ Error: ' + err.message);
    } finally {
    setLoading(false);
    }
  }

  const [savedAnalyses, setSavedAnalyses] = useState([]);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    loadAnalyses();
    loadStats();
  }, []);

  async function loadAnalyses() {
    try {
      const res = await fetch('/api/analyses?limit=5');
      const data = await res.json();
      if (data && data.analyses) {
        setSavedAnalyses(data.analyses);
      }
    } catch (err) {
      console.error('Failed to load analyses:', err);
    }
  }

  async function loadStats() {
    try {
      const res = await fetch('/api/analyses?stats=true');
      const data = await res.json();
      if (data && data.stats) {
        setStats(data.stats);
      }
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  }

  const getConnectionBadge = () => {
    const statusClass = connectionStatus === 'connected' ? 'connected' : 
                       connectionStatus === 'connecting' ? 'connecting' : 'disconnected';
  return (
      <div className={`status-indicator ${statusClass}`}>
        <span className={`status-dot ${statusClass}`}></span>
        {connectionStatus === 'connected' ? 'Live' : 
         connectionStatus === 'connecting' ? 'Connecting...' : 'Offline'}
      </div>
    );
  };

  return (
    <div style={{ minHeight: '100vh', padding: '20px 0' }}>
      <Container fluid className="py-4">
        <ToastContainer position="top-end" className="p-3">
          <Toast show={showToast} onClose={() => setShowToast(false)} delay={3000} autohide bg="success">
            <Toast.Header>
              <strong className="me-auto">✅ Success!</strong>
            </Toast.Header>
            <Toast.Body className="text-white">Analysis completed successfully!</Toast.Body>
          </Toast>
        </ToastContainer>

        {/* Header */}
        <Row className="mb-4">
          <Col>
            <Card className="glass-card card-modern">
              <Card.Body className="p-4">
                <div className="d-flex justify-content-between align-items-center flex-wrap">
                  <div>
                    <h1 className="display-5 fw-bold mb-2" style={{ 
                      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                      WebkitBackgroundClip: 'text',
                      WebkitTextFillColor: 'transparent'
                    }}>
                      🖼️ AI Image Analyzer
                    </h1>
                    <p className="text-muted mb-0">
                      <strong>Real-time</strong> image analysis powered by advanced AI vision models
                    </p>
                  </div>
                  <div className="mt-3 mt-md-0 d-flex align-items-center gap-3">
                    {getConnectionBadge()}
                    {stats && (
                      <Badge bg="info" className="badge-modern">
                        📊 {stats.totalAnalyses || 0} Total
                      </Badge>
                    )}
                    {loading && analysisTime > 0 && (
                      <Badge bg="warning" className="badge-modern">
                        ⏱️ {analysisTime}s
                      </Badge>
                    )}
                  </div>
                </div>
              </Card.Body>
            </Card>
          </Col>
        </Row>

        {error && (
          <Alert variant="danger" dismissible onClose={() => setError(null)} className="shadow fade-in">
            <Alert.Heading>⚠️ Error</Alert.Heading>
            {error}
            <div className="mt-2">
              <Button size="sm" variant="outline-danger" onClick={() => {
                setError(null);
                if (file) analyzeRealtime();
              }}>
                Retry
              </Button>
            </div>
          </Alert>
        )}

        <Row>
          {/* Left Column - Upload & Controls */}
          <Col lg={4} className="mb-4">
            <Card className="glass-card card-modern h-100">
              <Card.Header className="gradient-primary text-white">
                <h4 className="mb-0 d-flex align-items-center">
                  <span className="me-2">📤</span> Upload Image
                </h4>
              </Card.Header>
              <Card.Body>
                <div className="text-center mb-4">
                  <div 
                    className={`upload-area ${preview ? '' : 'd-flex flex-column justify-content-center align-items-center'}`}
                    onClick={() => document.getElementById('fileInput')?.click()}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.currentTarget.classList.add('dragover');
                    }}
                    onDragLeave={(e) => {
                      e.currentTarget.classList.remove('dragover');
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.currentTarget.classList.remove('dragover');
                      const files = e.dataTransfer.files;
                      if (files.length > 0) {
                        const f = files[0];
                        if (f.type.startsWith('image/')) {
                          setFile(f);
                          setPreview(URL.createObjectURL(f));
                        }
                      }
                    }}
                  >
                    <input 
                      type="file" 
                      accept="image/*" 
                      onChange={handleFile}
                      className="d-none"
                      id="fileInput"
                    />
                    {preview ? (
                      <div className="fade-in">
                        <img 
                          src={preview} 
                          alt="preview" 
                          className="img-fluid rounded shadow"
                          style={{ maxHeight: '300px', maxWidth: '100%' }}
                        />
                        {file && (
                          <p className="text-muted mt-2 mb-0">
                            <small>{file.name} ({(file.size / 1024).toFixed(2)} KB)</small>
                          </p>
                        )}
                      </div>
                    ) : (
                      <div>
                        <div className="mb-3" style={{ fontSize: '3rem' }}>📷</div>
                        <p className="text-muted mb-2">Click or drag to upload</p>
                        <small className="text-muted">Supports: JPG, PNG, GIF, WebP</small>
                      </div>
                    )}
        </div>
      </div>

                {loading && (
                  <div className="mb-4 fade-in">
                    <div className="d-flex justify-content-between align-items-center mb-2">
                      <span className="fw-bold text-primary small">{currentStep}</span>
                      <span className="fw-bold text-primary">{progress}%</span>
                    </div>
                    <div className="progress-container">
                      <div 
                        className="progress-bar-custom" 
                        style={{ width: `${progress}%` }}
                      ></div>
                    </div>
                    {analysisTime > 0 && (
                      <p className="text-center text-muted mt-2 mb-0 small">
                        ⏱️ Analyzing for {analysisTime} seconds...
                      </p>
                    )}
                  </div>
                )}

                <div className="d-grid gap-2">
                  <Button
                    variant="primary"
                    size="lg"
                    onClick={analyzeRealtime}
                    disabled={!file || loading}
                    className="btn-modern gradient-primary text-white"
                  >
                    {loading ? (
                      <>
                        <Spinner animation="border" size="sm" className="me-2" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <span className="me-2">🚀</span>
                        Analyze (Real-time)
                      </>
                    )}
                  </Button>
                  <Button
                    variant="success"
                    size="lg"
                    onClick={analyze}
                    disabled={!file || loading}
                    className="btn-modern gradient-success text-white"
                  >
                    {loading ? (
                      <>
                        <Spinner animation="border" size="sm" className="me-2" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <span className="me-2">⚡</span>
                        Analyze (Quick)
                      </>
                    )}
                  </Button>
                </div>
              </Card.Body>
            </Card>
          </Col>

          {/* Right Column - Results & Logs */}
          <Col lg={8}>
            {/* Real-time Logs */}
            {logs.length > 0 && (
              <Card className="glass-card card-modern mb-4 fade-in">
                <Card.Header className="glass-card-dark d-flex justify-content-between align-items-center">
                  <h5 className="mb-0 d-flex align-items-center">
                    <span className="me-2">📊</span> Real-Time Activity
                  </h5>
                  <Badge bg="success" className="badge-modern pulse">
                    {logs.length} events
                  </Badge>
                </Card.Header>
                <Card.Body className="p-0">
                  <div className="realtime-log">
                    {logs.map((l, i) => (
                      <div key={i} className="log-entry fade-in">
                        <span className="log-timestamp">{l.split(']')[0]}]</span>
                        <span className="log-icon">{l.includes('✅') ? '✅' : l.includes('🔄') ? '🔄' : l.includes('❌') ? '❌' : l.includes('📤') ? '📤' : l.includes('🔌') ? '🔌' : l.includes('📝') ? '📝' : l.includes('ℹ️') ? 'ℹ️' : '•'}</span>
                        {l.split('] ')[1]}
                      </div>
                    ))}
                    <div ref={logsEndRef} />
                  </div>
                </Card.Body>
              </Card>
            )}

            {/* Results */}
            {result && (
              <div className="fade-in">
                <Card className="glass-card card-modern mb-4">
                  <Card.Header className="gradient-primary text-white">
                    <h3 className="mb-0 d-flex align-items-center">
                      <span className="me-2">✨</span> Analysis Results
                    </h3>
                  </Card.Header>
                  <Card.Body>
                    {/* Uploaded Image Display */}
                    {preview && (
                      <Card className="mb-4 border-0 shadow-sm">
                        <Card.Header className="bg-light">
                          <h5 className="mb-0">📷 Analyzed Image</h5>
                        </Card.Header>
                        <Card.Body className="text-center p-3">
                          <img 
                            src={preview} 
                            alt="Uploaded image for analysis" 
                            style={{ 
                              maxWidth: '100%', 
                              maxHeight: '500px', 
                              borderRadius: '12px',
                              boxShadow: '0 8px 16px rgba(0,0,0,0.15)'
                            }} 
                          />
                          {file && (
                            <p className="text-muted mt-3 mb-0">
                              <small>📄 {file.name} • {(file.size / 1024).toFixed(2)} KB</small>
                            </p>
                          )}
                        </Card.Body>
                      </Card>
                    )}

                    {/* What is this image? - Main Answer */}
                    <Alert variant="info" className="border-0 shadow-sm mb-4">
                      <Alert.Heading className="d-flex align-items-center">
                        <span className="me-2">🔍</span> What is this image?
                      </Alert.Heading>
                      <h4 className="mt-3 mb-0" style={{ lineHeight: '1.6', fontWeight: 500 }}>
                        {result.imageSummary || result.caption || result.detailedExplanation?.substring(0, 200) || 'Image analysis completed'}
                      </h4>
                    </Alert>

                    {/* Extracted Text - Prominent Display */}
                    {result.extractedText && result.extractedText.trim() && (
                      <Card className="mb-4 border-success shadow-lg fade-in" style={{ borderWidth: '2px' }}>
                        <Card.Header className="gradient-success text-white d-flex justify-content-between align-items-center">
                          <h4 className="mb-0 d-flex align-items-center">
                            <span className="me-2">📝</span> Text Content Found in Image
                          </h4>
                          <Button
                            variant="light"
                            size="sm"
                            onClick={() => {
                              navigator.clipboard.writeText(result.extractedText);
                              setShowToast(true);
                            }}
                            className="btn-modern"
                          >
                            📋 Copy Text
                          </Button>
                        </Card.Header>
                        <Card.Body className="p-4">
                          <div 
                            className="bg-light p-4 rounded border"
                            style={{
                              fontFamily: 'monospace',
                              fontSize: '1.1rem',
                              lineHeight: '1.8',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                              backgroundColor: '#f8f9fa',
                              border: '2px solid #dee2e6',
                              minHeight: '60px',
                              maxHeight: '400px',
                              overflowY: 'auto'
                            }}
                          >
                            {result.extractedText}
                          </div>
                          <div className="mt-3 d-flex flex-wrap gap-2">
                            <Badge bg="success" className="badge-modern">
                              📊 {result.extractedText.split(/\s+/).filter(w => w.length > 0).length} words extracted
                            </Badge>
                            <Badge bg="info" className="badge-modern">
                              📏 {result.extractedText.length} characters
                            </Badge>
                            <Badge bg="primary" className="badge-modern">
                              📄 {result.extractedText.split('\n').filter(l => l.trim().length > 0).length} lines
                            </Badge>
                          </div>
                        </Card.Body>
                      </Card>
                    )}

                    {/* Show message if no text found */}
                    {result && (!result.extractedText || !result.extractedText.trim()) && (
                      <Card className="mb-4 border-warning shadow-sm">
                        <Card.Header className="bg-warning text-dark">
                          <h5 className="mb-0 d-flex align-items-center">
                            <span className="me-2">ℹ️</span> Text Content
                          </h5>
                        </Card.Header>
                        <Card.Body>
                          <p className="text-muted mb-0">
                            No text was detected in this image. The image may contain only visual elements without any written text.
                          </p>
                        </Card.Body>
                      </Card>
                    )}

                    {/* What the Image Contains - Comprehensive List */}
                    <Card className="mb-4 border-primary shadow-lg fade-in" style={{ borderWidth: '2px' }}>
                      <Card.Header className="bg-primary text-white">
                        <h4 className="mb-0 d-flex align-items-center">
                          <span className="me-2">📋</span> Complete Image Contents
                        </h4>
                      </Card.Header>
                      <Card.Body className="p-4">
                        <Row>
                          {/* Main Content Summary */}
                          <Col md={12} className="mb-4">
                            <div className="p-4 bg-light rounded border-start border-primary border-4 shadow-sm">
                              <strong className="text-primary d-block mb-3" style={{ fontSize: '1.1rem' }}>
                                📄 Full Content Description:
                              </strong>
                              <p className="mb-0" style={{ lineHeight: '1.9', fontSize: '1.05rem', color: '#333' }}>
                                {result.detailedExplanation || result.imageSummary || 'Analysis in progress...'}
                              </p>
                            </div>
                          </Col>

                          {/* Detected Objects */}
                          {result.detectedElements && Array.isArray(result.detectedElements) && result.detectedElements.length > 0 && (
                            <Col md={12} className="mb-4">
                              <div className="p-4 bg-light rounded border-start border-info border-4 shadow-sm">
                                <strong className="text-primary d-block mb-3" style={{ fontSize: '1.1rem' }}>
                                  🔍 All Detected Objects & Elements ({result.detectedElements.length}):
                                </strong>
                                <div className="d-flex flex-wrap gap-2">
                                  {result.detectedElements.map((el, idx) => (
                                    <Badge key={idx} bg="primary" className="badge-modern" style={{ fontSize: '0.95rem', padding: '8px 16px' }}>
                                      {el}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            </Col>
                          )}

                          {/* People */}
                          {result.people && result.people !== 'Not specified' && result.people !== 'No people detected' && (
                            <Col md={6} className="mb-3">
                              <div className="p-3 bg-light rounded h-100 border-start border-success border-4 shadow-sm">
                                <strong className="text-primary d-block mb-2">👥 People Detected:</strong>
                                <p className="mb-0" style={{ fontSize: '0.95rem', lineHeight: '1.7' }}>{result.people}</p>
                              </div>
                            </Col>
                          )}

                          {/* Colors */}
                          {result.colors && result.colors !== 'Not specified' && (
                            <Col md={6} className="mb-3">
                              <div className="p-3 bg-light rounded h-100 border-start border-warning border-4 shadow-sm">
                                <strong className="text-primary d-block mb-2">🎨 Color Scheme:</strong>
                                <p className="mb-0" style={{ fontSize: '0.95rem', lineHeight: '1.7' }}>{result.colors}</p>
                              </div>
                            </Col>
                          )}

                          {/* Environment */}
                          {result.environment && result.environment !== 'Not specified' && (
                            <Col md={6} className="mb-3">
                              <div className="p-3 bg-light rounded h-100 border-start border-info border-4 shadow-sm">
                                <strong className="text-primary d-block mb-2">🌍 Environment:</strong>
                                <p className="mb-0" style={{ fontSize: '0.95rem', lineHeight: '1.7' }}>{result.environment}</p>
                              </div>
                            </Col>
                          )}

                          {/* Domain */}
                          {result.domain && result.domain !== 'Unknown' && (
                            <Col md={6} className="mb-3">
                              <div className="p-3 bg-light rounded h-100 border-start border-danger border-4 shadow-sm">
                                <strong className="text-primary d-block mb-2">🏷️ Category/Domain:</strong>
                                <p className="mb-0 fw-bold" style={{ fontSize: '1.15rem', color: '#667eea' }}>{result.domain}</p>
                              </div>
                            </Col>
                          )}
                        </Row>
                      </Card.Body>
                    </Card>

                    {/* Image Properties */}
                    {result.imageProperties && (
                      <Card className="mb-4 border-primary shadow-sm">
                        <Card.Header className="bg-primary text-white">
                          <h5 className="mb-0">📐 Image Properties</h5>
                        </Card.Header>
                        <Card.Body>
                          <Row>
                            <Col md={6} className="mb-3">
                              <div className="info-card">
                                <div className="info-card-title">Dimensions</div>
                                <div className="info-card-value">
                                  {result.imageProperties.width} × {result.imageProperties.height} px
                                </div>
                              </div>
                            </Col>
                            <Col md={6} className="mb-3">
                              <div className="info-card">
                                <div className="info-card-title">Format</div>
                                <div className="info-card-value">
                                  {result.imageProperties.format?.toUpperCase() || 'Unknown'}
                                </div>
                              </div>
                            </Col>
                            <Col md={6} className="mb-3">
                              <div className="info-card">
                                <div className="info-card-title">File Size</div>
                                <div className="info-card-value">
                                  {result.imageProperties.fileSizeMB} MB
                                </div>
                              </div>
                            </Col>
                            <Col md={6} className="mb-3">
                              <div className="info-card">
                                <div className="info-card-title">Megapixels</div>
                                <div className="info-card-value">
                                  {result.imageProperties.megapixels} MP
                                </div>
                              </div>
                            </Col>
                            <Col md={6} className="mb-3">
                              <div className="info-card">
                                <div className="info-card-title">Aspect Ratio</div>
                                <div className="info-card-value">
                                  {result.imageProperties.aspectRatio}:1
                                </div>
                              </div>
                            </Col>
                            <Col md={6} className="mb-3">
                              <div className="info-card">
                                <div className="info-card-title">Color Channels</div>
                                <div className="info-card-value">
                                  {result.imageProperties.channels || 'N/A'}
                                </div>
                              </div>
                            </Col>
                          </Row>
                        </Card.Body>
                      </Card>
                    )}

                    {/* Domain & Confidence */}
                    <Row className="mb-4">
                      {result.domain && (
                        <Col md={6} className="mb-3">
                          <Card className="gradient-warning text-white border-0 shadow-sm">
                            <Card.Body>
                              <div className="info-card-title text-white" style={{ opacity: 0.9 }}>Domain/Category</div>
                              <h4 className="mb-0 mt-2">{result.domain}</h4>
                            </Card.Body>
                          </Card>
                        </Col>
                      )}
                      {result.confidenceLevel && (
                        <Col md={6} className="mb-3">
                          <Card className={`bg-${result.confidenceLevel === 'High' ? 'success' : result.confidenceLevel === 'Medium' ? 'warning' : 'danger'} text-white border-0 shadow-sm`}>
                            <Card.Body>
                              <div className="info-card-title text-white" style={{ opacity: 0.9 }}>Confidence</div>
                              <h4 className="mb-0 mt-2">{result.confidenceLevel}</h4>
                            </Card.Body>
                          </Card>
                        </Col>
                      )}
                    </Row>


                    {/* Detailed Information Cards */}
                    {result.detailedExplanation && (
                      <Card className="mb-4 shadow-sm">
                        <Card.Header className="bg-light">
                          <h5 className="mb-0">📖 Detailed Explanation</h5>
                        </Card.Header>
                        <Card.Body>
                          <p style={{ lineHeight: '1.8', fontSize: '1rem' }}>
                            {result.detailedExplanation}
                          </p>
                        </Card.Body>
                      </Card>
                    )}

                    {result.colors && result.colors !== 'Not specified' && (
                      <Card className="mb-4 shadow-sm">
                        <Card.Header className="bg-light">
                          <h5 className="mb-0">🎨 Colors</h5>
                        </Card.Header>
                        <Card.Body>
                          <p>{result.colors}</p>
                        </Card.Body>
                      </Card>
                    )}

                    {result.environment && result.environment !== 'Not specified' && (
                      <Card className="mb-4 shadow-sm">
                        <Card.Header className="bg-light">
                          <h5 className="mb-0">🌍 Environment</h5>
                        </Card.Header>
                        <Card.Body>
                          <p>{result.environment}</p>
                        </Card.Body>
                      </Card>
                    )}


                    {result.realWorldApplications && (
                      <Card className="mb-4 shadow-sm">
                        <Card.Header className="bg-light">
                          <h5 className="mb-0">💡 Real-World Applications</h5>
                        </Card.Header>
                        <Card.Body>
                          <p>{result.realWorldApplications}</p>
                        </Card.Body>
                      </Card>
                    )}

                    {result.educationalInsight && (
                      <Card className="mb-4 shadow-sm">
                        <Card.Header className="bg-light">
                          <h5 className="mb-0">🎓 Educational Insight</h5>
                        </Card.Header>
                        <Card.Body>
                          <p>{result.educationalInsight}</p>
                        </Card.Body>
                      </Card>
                    )}
                  </Card.Body>
                </Card>
              </div>
            )}

            {/* Empty State */}
            {!result && !loading && (
              <Card className="glass-card card-modern text-center">
                <Card.Body className="py-5">
                  <div className="mb-3" style={{ fontSize: '4rem' }}>📤</div>
                  <h3 className="text-muted mb-3">Ready to Analyze</h3>
                  <p className="text-muted">Upload an image and click "Analyze" to see real-time analysis results!</p>
                </Card.Body>
              </Card>
            )}
          </Col>
        </Row>
      </Container>
    </div>
  );
}
