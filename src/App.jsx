import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import AppLayout from './components/layout/AppLayout.jsx';
import SettingsPage from './components/settings/SettingsPage.jsx';
import TutorialOverlay from './components/tutorial/TutorialOverlay.jsx';
import OnboardingWizard from './components/onboarding/OnboardingWizard.jsx';
import { DEFAULT_PLANNING_MODEL } from './config/providers.js';
import { validateKey } from './services/ai-client.js';
import { generateImage, humanizeError } from './services/ai-client.js';
import { buildFallbackStoryboardFrame, buildSceneImagePrompt } from './services/scene-images.js';
import { saveImage, resolveImagePath, getActiveUserId } from './services/storage.js';
import { downloadProjectBundle, pickAndImportProjectBundle } from './services/project-io.js';
import { exportStoryboardToPdf } from './services/pdf-export.js';
import { useProjectStore } from './store/project-store.js';
import { useSettingsStore } from './store/settings-store.js';
import { useAuthStore } from './store/auth-store.js';
import { confirm as confirmDialog, alertModal } from './store/dialog-store.js';
import DialogHost from './components/common/DialogHost.jsx';

import { findSceneById, findSequence, moveActInPlace, moveSceneInPlace } from './utils/storyboard-ops.js';
import './App.css';

const CHARACTER_COLORS = ['#10a37f', '#7c8cff', '#e96f4a', '#2f7ad6', '#b052cc', '#e0a100'];

export default function App() {
  const [sidebarTab, setSidebarTab] = useState('stories');
  const [hubOpen, setHubOpen] = useState(false);
  const [selectedActRef, setSelectedActRef] = useState(null);
  const [selectedSequenceRef, setSelectedSequenceRef] = useState(null);
  const [activeCharacterId, setActiveCharacterId] = useState('');
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);
  const [showTutorial, setShowTutorial] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('sb-theme') || 'dark');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('sb-theme', theme);
  }, [theme]);

  const onToggleTheme = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  const showToast = useCallback((message, type = 'error') => {
    clearTimeout(toastTimerRef.current);
    setToast({ message, type });
    toastTimerRef.current = setTimeout(() => setToast(null), 4000);
  }, []);

  const settingsStore = useSettingsStore();
  const projectStore = useProjectStore();
  const authStore = useAuthStore();


  useEffect(() => {
    authStore.init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Init app stores only after auth resolves, and re-init when user identity changes (e.g. guest → signed-in)
  const isAuthenticated = authStore.user || authStore.guestMode;
  const authUserId = authStore.user?.uid || (authStore.guestMode ? getActiveUserId() : null);
  useEffect(() => {
    if (!authStore.loading && isAuthenticated) {
      settingsStore.init();
      projectStore.init();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStore.loading, isAuthenticated, authUserId]);

  // Show tutorial on first visit per user/guest
  useEffect(() => {
    if (authStore.loading || !isAuthenticated) return;
    const tutorialKey = getTutorialStorageKey(authStore.user, authStore.guestMode);
    if (tutorialKey && !localStorage.getItem(tutorialKey)) {
      setShowTutorial(true);
    }
  }, [authStore.loading, isAuthenticated, authStore.user, authStore.guestMode]);

  const activeProject = projectStore.activeProject;

  const selectedSceneLookup = useMemo(
    () => findSceneById(activeProject?.storyboard, projectStore.selectedSceneId),
    [activeProject?.storyboard, projectStore.selectedSceneId]
  );
  const selectedScene = selectedSceneLookup?.scene || null;
  const selectedSequence = useMemo(
    () =>
      findSequence(
        activeProject?.storyboard,
        selectedSequenceRef?.actNumber,
        selectedSequenceRef?.sequenceNumber
      ),
    [activeProject?.storyboard, selectedSequenceRef]
  );
  const selectedAct = useMemo(
    () => findAct(activeProject?.storyboard, selectedActRef?.actNumber),
    [activeProject?.storyboard, selectedActRef]
  );

  const stats = useMemo(() => {
    const scenes = countScenes(activeProject?.storyboard);
    const characters = activeProject?.entities?.characters?.length || 0;
    const locations = activeProject?.entities?.locations?.length || 0;
    return { scenes, characters, locations };
  }, [activeProject]);

  async function updateProject(mutator) {
    projectStore.setActiveProject((currentProject) => {
      if (!currentProject) {
        return currentProject;
      }

      const nextProject = structuredClone(currentProject);
      mutator(nextProject);
      normalizeSceneNumbers(nextProject.storyboard);
      return nextProject;
    });

    await projectStore.saveCurrentProject();
  }

  function handleSelectScene(sceneId) {
    const cleanSceneId = String(sceneId || '').trim();
    if (!cleanSceneId) {
      projectStore.clearSelection();
      return;
    }

    const lookup = findSceneById(activeProject?.storyboard, cleanSceneId);
    projectStore.selectScene(cleanSceneId);

    if (!lookup) {
      return;
    }

    setSelectedActRef({ actNumber: lookup.act.number });
    setSelectedSequenceRef({
      actNumber: lookup.act.number,
      sequenceNumber: lookup.sequence.number,
    });
  }

  async function handleCreateCharacter(draft, options = {}) {
    let createdCharacterId = '';

    await updateProject((project) => {
      const entities = ensureEntities(project);
      createdCharacterId = addCharacter(entities, draft);

      if (!createdCharacterId || !options.linkToSceneId) {
        return;
      }

      const target = findSceneById(project.storyboard, options.linkToSceneId)?.scene;
      if (!target) {
        return;
      }
      target.characterIds = uniqueStrings([...(target.characterIds || []), createdCharacterId]);
    });

    return createdCharacterId;
  }

  async function handleCreateSceneManual(payload) {
    const actNumber = Number(payload?.actNumber);
    const sequenceNumber = Number(payload?.sequenceNumber);
    if (!actNumber || !sequenceNumber) {
      return;
    }

    await updateProject((project) => {
      const sequence = findSequence(project.storyboard, actNumber, sequenceNumber);
      if (!sequence) {
        return;
      }

      const manual = payload?.manual || {};
      const entities = ensureEntities(project);

      const linkedCharacterIds = uniqueStrings(manual.characterIds);
      const newCharacterId = addCharacter(entities, payload?.newCharacter);
      if (newCharacterId) {
        linkedCharacterIds.push(newCharacterId);
      }

      sequence.scenes.push({
        id: createSceneId(),
        sceneNumber: '',
        title: String(manual.title || '').trim() || `Shot ${sequence.scenes.length + 1}`,
        location: String(manual.location || '').trim(),
        time: String(manual.time || '').trim(),
        visualDescription: String(manual.visualDescription || '').trim(),
        action: String(manual.action || '').trim(),
        dialogue: [],
        mood: String(manual.mood || '').trim(),
        storyFunction: String(manual.storyFunction || '').trim(),
        characterIds: linkedCharacterIds,
        locationIds: [],
        imageUrl: null,
        imagePrompt: '',
        imagePromptHash: '',
        imageStatus: 'idle',
        imageError: '',
        imageUpdatedAt: null,
        imageProvider: '',
        imageModelResolved: '',
        imageAttemptedAt: null,
        imageLatencyMs: null,
        imageDiagnosticCode: '',
        imageDiagnosticMessage: '',
        imagePromptPreview: '',
      });
    });
  }

  async function handleDeleteScene(sceneId) {
    const cleanSceneId = String(sceneId || '').trim();
    if (!cleanSceneId) {
      return;
    }

    const ok = await confirmDialog({
      title: 'Delete this shot?',
      message: 'The shot and its generated image will be removed. This cannot be undone.',
      destructive: true,
      confirmLabel: 'Delete shot',
    });
    if (!ok) {
      return;
    }

    await updateProject((project) => {
      for (const act of project.storyboard.acts || []) {
        for (const sequence of act.sequences || []) {
          sequence.scenes = (sequence.scenes || []).filter((scene) => scene.id !== cleanSceneId);
        }
      }
    });

    if (projectStore.selectedSceneId === cleanSceneId) {
      projectStore.clearSelection();
    }
  }

  async function handleDeleteAct(actNumber) {
    const targetActNumber = Number(actNumber);
    if (!targetActNumber) {
      return;
    }

    const ok = await confirmDialog({
      title: 'Delete this sequence?',
      message: 'All scenes and shots inside this sequence will be deleted. This cannot be undone.',
      destructive: true,
      confirmLabel: 'Delete sequence',
    });
    if (!ok) {
      return;
    }

    const selectedLookup = projectStore.selectedSceneId
      ? findSceneById(activeProject?.storyboard, projectStore.selectedSceneId)
      : null;
    const shouldClearSelection = Number(selectedLookup?.act?.number) === targetActNumber;
    const shouldClearActFocus = Number(selectedActRef?.actNumber) === targetActNumber;
    const shouldClearSceneFocus = Number(selectedSequenceRef?.actNumber) === targetActNumber;

    await updateProject((project) => {
      const acts = Array.isArray(project?.storyboard?.acts) ? project.storyboard.acts : [];
      project.storyboard.acts = acts.filter((act) => Number(act?.number) !== targetActNumber);
    });

    if (shouldClearSelection) {
      projectStore.clearSelection();
    }
    if (shouldClearActFocus) {
      setSelectedActRef(null);
    }
    if (shouldClearSceneFocus) {
      setSelectedSequenceRef(null);
    }
  }

  async function handleDeleteSequence(payload) {
    const targetActNumber = Number(payload?.actNumber);
    const targetSequenceNumber = Number(payload?.sequenceNumber);
    if (!targetActNumber || !targetSequenceNumber) {
      return;
    }

    const ok = await confirmDialog({
      title: 'Delete this scene?',
      message: 'All shots inside this scene will be deleted. This cannot be undone.',
      destructive: true,
      confirmLabel: 'Delete scene',
    });
    if (!ok) {
      return;
    }

    const selectedLookup = projectStore.selectedSceneId
      ? findSceneById(activeProject?.storyboard, projectStore.selectedSceneId)
      : null;
    const shouldClearSelection =
      Number(selectedLookup?.act?.number) === targetActNumber &&
      Number(selectedLookup?.sequence?.number) === targetSequenceNumber;
    const shouldClearSceneFocus =
      Number(selectedSequenceRef?.actNumber) === targetActNumber &&
      Number(selectedSequenceRef?.sequenceNumber) === targetSequenceNumber;

    await updateProject((project) => {
      const act = (project?.storyboard?.acts || []).find(
        (item) => Number(item?.number) === targetActNumber
      );
      if (!act) {
        return;
      }
      act.sequences = (act.sequences || []).filter(
        (sequence) => Number(sequence?.number) !== targetSequenceNumber
      );
    });

    if (shouldClearSelection) {
      projectStore.clearSelection();
    }
    if (shouldClearSceneFocus) {
      setSelectedSequenceRef(null);
    }
  }

  async function handleRenameAct(actNumber, title) {
    const targetActNumber = Number(actNumber);
    const nextTitle = String(title || '').trim();
    if (!targetActNumber || !nextTitle) {
      return;
    }

    await updateProject((project) => {
      const act = (project?.storyboard?.acts || []).find(
        (item) => Number(item?.number) === targetActNumber
      );
      if (!act) {
        return;
      }
      act.title = nextTitle;
    });
  }

  async function handleRenameSequence(payload) {
    const targetActNumber = Number(payload?.actNumber);
    const targetSequenceNumber = Number(payload?.sequenceNumber);
    const nextTitle = String(payload?.title || '').trim();
    if (!targetActNumber || !targetSequenceNumber || !nextTitle) {
      return;
    }

    await updateProject((project) => {
      const act = (project?.storyboard?.acts || []).find(
        (item) => Number(item?.number) === targetActNumber
      );
      if (!act) {
        return;
      }
      const sequence = (act.sequences || []).find(
        (item) => Number(item?.number) === targetSequenceNumber
      );
      if (!sequence) {
        return;
      }
      sequence.title = nextTitle;
    });
  }

  async function handleUpdateScene(sceneId, changes) {
    const cleanSceneId = String(sceneId || '').trim();
    if (!cleanSceneId || !changes || typeof changes !== 'object') {
      return;
    }

    await updateProject((project) => {
      const targetScene = findSceneById(project.storyboard, cleanSceneId)?.scene;
      if (!targetScene) {
        return;
      }
      Object.assign(targetScene, changes);
    });
  }

  async function handleSetSceneCharacters(sceneId, characterIds) {
    const safeIds = uniqueStrings(characterIds);
    await handleUpdateScene(sceneId, { characterIds: safeIds });
  }

  async function handleSetSceneImage(sceneId, imageUrl) {
    await handleUpdateScene(sceneId, {
      imageUrl: imageUrl || null,
      imageStatus: imageUrl ? 'ready' : 'idle',
      imageError: '',
      imageUpdatedAt: new Date().toISOString(),
      imageProvider: imageUrl ? 'manual' : '',
      imageModelResolved: '',
      imageAttemptedAt: imageUrl ? new Date().toISOString() : null,
      imageLatencyMs: null,
      imageDiagnosticCode: '',
      imageDiagnosticMessage: '',
      imagePromptPreview: '',
    });
  }

  async function handleMoveScene(payload) {
    await updateProject((project) => {
      moveSceneInPlace(project.storyboard, payload);
    });
  }

  async function handleMoveAct(payload) {
    await updateProject((project) => {
      const acts = Array.isArray(project?.storyboard?.acts) ? project.storyboard.acts : [];
      moveActInPlace(acts, payload);
    });
  }

  async function handleGenerateAiImage(sceneId, options = {}) {
    const lookup = findSceneById(activeProject?.storyboard, sceneId);
    const mergedScene = {
      ...(lookup?.scene || {}),
      ...(options?.draft && typeof options.draft === 'object' ? options.draft : {}),
    };
    const basePrompt = buildSceneImagePrompt(
      mergedScene,
      activeProject?.entities || { characters: [], locations: [] }
    );
    const additionalDirection = String(options?.additionalDirection || '').trim();
    const text = additionalDirection
      ? `${basePrompt}\nAdditional direction: ${additionalDirection}`
      : basePrompt;

    if (!text.trim()) {
      return;
    }

    try {
      await handleUpdateScene(sceneId, {
        imageStatus: 'generating',
        imageError: '',
        imageUpdatedAt: new Date().toISOString(),
        imageDiagnosticCode: '',
        imageDiagnosticMessage: '',
      });

      const imageResult = await generateImage({
        model: settingsStore.imageModel,
        prompt: text,
      });

      // Save image to disk and get local path (skip for SVG placeholders)
      let resolvedUrl = imageResult.imageUrl;
      if (!resolvedUrl.startsWith('data:image/svg+xml')) {
        const localPath = await saveImage(sceneId, resolvedUrl);
        resolvedUrl = localPath ? await resolveImagePath(localPath) : resolvedUrl;
      }

      await handleUpdateScene(sceneId, {
        imageUrl: resolvedUrl || imageResult.imageUrl,
        imagePrompt: text,
        imageStatus: 'ready',
        imageError: '',
        imageUpdatedAt: new Date().toISOString(),
        imageProvider: String(imageResult.provider || 'openrouter'),
        imageModelResolved: String(imageResult.model || settingsStore.imageModel),
        imageAttemptedAt: new Date().toISOString(),
        imageLatencyMs: Number(imageResult.latencyMs || 0) || null,
        imageDiagnosticCode: String(imageResult.diagnosticCode || 'success'),
        imageDiagnosticMessage: String(imageResult.diagnosticMessage || ''),
        imagePromptPreview: String(text || '').slice(0, 220),
      });
    } catch (error) {
      const errorObj = humanizeError(error);
      showToast(errorObj.message);
      const lookupScene = findSceneById(activeProject?.storyboard, sceneId)?.scene;
      await handleUpdateScene(sceneId, {
        imageUrl: buildFallbackStoryboardFrame(lookupScene || { title: text }, text),
        imageStatus: 'fallback',
        imageError: errorObj.message,
        imageUpdatedAt: new Date().toISOString(),
        imageProvider: 'openrouter',
        imageModelResolved: String(error?.model || settingsStore.imageModel),
        imageAttemptedAt: new Date().toISOString(),
        imageLatencyMs: Number(error?.latencyMs || 0) || null,
        imageDiagnosticCode: String(error?.diagnosticCode || 'fallback_used'),
        imageDiagnosticMessage: String(error?.diagnosticMessage || errorObj.message),
        imagePromptPreview: String(text || '').slice(0, 220),
      });
    }
  }

  async function handleAddAct() {
    await updateProject((project) => {
      const acts = Array.isArray(project?.storyboard?.acts) ? project.storyboard.acts : [];
      const nextActNumber = acts.reduce((max, act) => Math.max(max, Number(act?.number) || 0), 0) + 1;

      acts.push({
        number: nextActNumber,
        title: `SEQUENCE ${nextActNumber}`,
        sequences: [
          {
            number: 1,
            title: 'New Scene',
            scenes: [],
          },
        ],
      });
    });
  }

  function handleGenerateSection(payload) {
    const actNumber = Number(payload?.actNumber);
    const sequenceNumber = Number(payload?.sequenceNumber);
    if (!actNumber || !sequenceNumber) {
      return;
    }

    const count = Math.max(1, Number(payload?.count || 1));
    const prompt = String(payload?.prompt || '').trim();
    const userMessage = [
      `Generate ${count} shot${count > 1 ? 's' : ''} for Sequence ${actNumber}, Scene ${sequenceNumber}.`,
      prompt || 'Keep narrative progression tight and production-friendly.',
      'Return concise shot updates and keep existing characters consistent.',
      'Append only new shots for this exact scene. Do not modify or reorder existing shots.',
    ].join(' ');

    projectStore.sendUserMessage(
      prompt || `Generate ${count} shot${count > 1 ? 's' : ''} for this scene.`,
      { apiContent: userMessage }
    );
  }

  async function handleExportPdf() {
    if (!activeProject) {
      return;
    }

    try {
      exportStoryboardToPdf(activeProject);
    } catch (error) {
      await alertModal({
        title: 'PDF export failed',
        message: error?.message || 'Unknown error.',
      });
    }
  }

  function handleEnhanceSceneWithAi(sceneId, prompt) {
    const lookup = findSceneById(activeProject?.storyboard, sceneId);
    if (!lookup?.scene) {
      return;
    }

    const extraPrompt = String(prompt || '').trim();
    const userMessage = [
      `Edit shot context ID: ${lookup.scene.id}.`,
      `Target shot title: "${lookup.scene.title || 'Untitled Shot'}".`,
      extraPrompt || 'Improve visual clarity, action beats, and emotional tension.',
      'Edit this exact shot using updates.scenes_update with this sceneId.',
      'Do not add new shots. Do not remove shots.',
    ].join(' ');

    projectStore.sendUserMessage(
      extraPrompt || `Enhance shot: ${lookup.scene.title || 'Untitled Shot'}.`,
      { apiContent: userMessage }
    );
  }

  function handleOpenCharacter(characterId) {
    const cleanId = String(characterId || '').trim();
    setActiveCharacterId(cleanId);
    setSidebarTab('entities');
    setHubOpen(true);
  }

  const projectProps = {
    projects: projectStore.projectIndex,
    activeProjectId: activeProject?.id,
    onSwitch: projectStore.switchProject,
    isCreating: isCreatingProject,
    onCreate: async () => {
      if (isCreatingProject) return;
      setIsCreatingProject(true);
      try {
        const name = `Story ${projectStore.projectIndex.length + 1}`;
        await projectStore.createProject(name);
      } finally {
        setIsCreatingProject(false);
      }
    },
    onDelete: async (projectId) => {
      const ok = await confirmDialog({
        title: 'Delete this story?',
        message: 'The project and all its scenes, shots, and generated images will be removed from your workspace. This cannot be undone.',
        destructive: true,
        confirmLabel: 'Delete story',
      });
      if (!ok) {
        return;
      }
      projectStore.deleteProjectById(projectId);
    },
    onRename: (projectId, name) => {
      projectStore.renameProjectById(projectId, name);
    },
    onExport: async (projectId) => {
      try {
        const filename = await downloadProjectBundle(projectId);
        setToast({ type: 'success', message: `Exported as ${filename}` });
      } catch (err) {
        setToast({ type: 'error', message: err?.message || 'Export failed.' });
      }
    },
    onImport: async () => {
      try {
        const newProjectId = await pickAndImportProjectBundle();
        if (!newProjectId) return;
        // Pull the fresh index so the imported story shows up in the sidebar.
        await projectStore.refreshProjectIndex?.();
        await projectStore.switchProject(newProjectId);
        setToast({ type: 'success', message: 'Story imported.' });
      } catch (err) {
        setToast({ type: 'error', message: err?.message || 'Import failed.' });
      }
    },
  };

  const onOpenSettings = useCallback(() => {
    setSettingsOpen(true);
    setHubOpen(false);
  }, []);

  function handleRestartTutorial() {
    const key = getTutorialStorageKey(authStore.user, authStore.guestMode);
    if (key) localStorage.removeItem(key);
    setShowTutorial(true);
  }

  const chatProps = {
    messages: activeProject?.messages || [],
    streamingText: projectStore.streamingText,
    streamedChars: projectStore.streamedChars,
    streamingActivity: projectStore.streamingActivity,
    streamingStartedAt: projectStore.streamingStartedAt,
    isStreaming: projectStore.isStreaming,
    isSending: projectStore.isSending,
    processingStatus: projectStore.processingStatus,
    processingPhase: projectStore.processingPhase,
    processingDetail: projectStore.processingDetail,
    selectedFocusLabel:
      selectedSequence && selectedSequenceRef
        ? `Scene focus: SQ${selectedSequenceRef?.actNumber} / SC${selectedSequenceRef?.sequenceNumber}: ${selectedSequence.title
        }`
        : selectedAct && selectedActRef
          ? `Sequence focus: SQ${selectedActRef?.actNumber}: ${selectedAct.title}`
          : '',
    onClearFocus: () => {
      setSelectedActRef(null);
      setSelectedSequenceRef(null);
    },
    onClearChat: async () => {
      setSelectedActRef(null);
      setSelectedSequenceRef(null);
      await projectStore.clearChatHistory();
    },
    chatMode: settingsStore.chatMode,
    chatModeOptions: settingsStore.chatModeOptions,
    onChatModeChange: settingsStore.setChatMode,
    onSend: (text) => {
      const message = String(text || '').trim();
      if (!message) {
        return;
      }

      if (selectedSequence && selectedSequenceRef) {
        const contextMessage = buildSequenceFocusedPrompt({
          userMessage: message,
          actNumber: selectedSequenceRef.actNumber,
          sequenceNumber: selectedSequenceRef.sequenceNumber,
          sequence: selectedSequence,
        });

        projectStore.sendUserMessage(message, { apiContent: contextMessage });
        return;
      }

      if (selectedAct && selectedActRef) {
        const contextMessage = buildActFocusedPrompt({
          userMessage: message,
          actNumber: selectedActRef.actNumber,
          act: selectedAct,
        });

        projectStore.sendUserMessage(message, { apiContent: contextMessage });
        return;
      }

      if (!selectedSequence || !selectedSequenceRef) {
        projectStore.sendUserMessage(message);
        return;
      }
    },
    onPreviewClick: handleSelectScene,
  };

  const storyboardProps = {
    storyboard: activeProject?.storyboard,
    entities: activeProject?.entities,
    selectedSceneId: projectStore.selectedSceneId,
    onSelectScene: handleSelectScene,
    onDeleteScene: handleDeleteScene,
    onCreateSceneManual: handleCreateSceneManual,
    onGenerateSection: handleGenerateSection,
    onGenerateImage: (sceneId) => handleGenerateAiImage(sceneId, ''),
    onMoveScene: handleMoveScene,
    onMoveAct: handleMoveAct,
    onAddAct: handleAddAct,
    onDeleteAct: handleDeleteAct,
    onDeleteSequence: handleDeleteSequence,
    onRenameAct: handleRenameAct,
    onRenameSequence: handleRenameSequence,
    onExportPdf: handleExportPdf,
    selectedAct: selectedActRef,
    onSelectAct: (payload) => {
      const actNumber = Number(payload?.actNumber);
      if (!actNumber) {
        setSelectedActRef(null);
        return;
      }

      setSelectedActRef((current) => {
        if (Number(current?.actNumber) === actNumber) {
          return null;
        }
        return { actNumber };
      });
      setSelectedSequenceRef(null);
    },
    selectedSequence: selectedSequenceRef,
    onSelectSequence: (payload) => {
      const actNumber = Number(payload?.actNumber);
      const sequenceNumber = Number(payload?.sequenceNumber);
      if (!actNumber || !sequenceNumber) {
        setSelectedSequenceRef(null);
        return;
      }

      setSelectedSequenceRef((current) => {
        if (
          Number(current?.actNumber) === actNumber &&
          Number(current?.sequenceNumber) === sequenceNumber
        ) {
          return null;
        }
        return { actNumber, sequenceNumber };
      });
      setSelectedActRef(null);
    },
    sceneDiffById: projectStore.sceneDiffById,
    onOpenCharacter: handleOpenCharacter,
  };

  const sceneDetailProps = {
    scene: selectedScene,
    sceneContextLabel: selectedSceneLookup
      ? `Sequence ${selectedSceneLookup.act.number} / Scene ${selectedSceneLookup.sequence.number}`
      : '',
    entities: activeProject?.entities,
    onClose: projectStore.clearSelection,
    onDeleteScene: handleDeleteScene,
    onUpdateScene: handleUpdateScene,
    onSetSceneImage: handleSetSceneImage,
    onGenerateAiImage: handleGenerateAiImage,
    onSetSceneCharacters: handleSetSceneCharacters,
    showToast,
    onCreateCharacter: handleCreateCharacter,
    onEnhanceSceneWithAi: handleEnhanceSceneWithAi,
  };

  const entityProps = {
    entities: activeProject?.entities,
    onCreateCharacter: (draft) => handleCreateCharacter(draft),
    activeCharacterId,
  };

  if (!settingsStore.initialized || !activeProject) {
    return (
      <>
        <main className="sb-loading">
          <p>Booting Storyboarder...</p>
        </main>
        <DialogHost />
      </>
    );
  }

  // First-run onboarding — gate the whole app behind the wizard if the user
  // has no OpenRouter key yet. They cannot use any AI features without it,
  // so sending them straight to the wizard is correct.
  const hasOpenrouterKey = !!(settingsStore.providerKeys?.openrouter || '').trim();
  if (!hasOpenrouterKey) {
    return (
      <>
        <OnboardingWizard
          onValidate={async (apiKey) => validateKey({ provider: 'openrouter', apiKey })}
          onComplete={async ({ apiKey }) => {
            await settingsStore.setProviderKey('openrouter', apiKey);
            // Planning model is pre-set to DEFAULT_PLANNING_MODEL (Opus 4.7)
            // by the settings store. Users can change it in Settings → Models.
            await settingsStore.setPlanningModel(DEFAULT_PLANNING_MODEL);
          }}
        />
        <DialogHost />
      </>
    );
  }

  if (settingsOpen) {
    return (
      <>
        <SettingsPage
          onClose={() => setSettingsOpen(false)}
          settingsStore={settingsStore}
          theme={theme}
          onToggleTheme={onToggleTheme}
        />
        <DialogHost />
      </>
    );
  }

  return (
    <>
      <DialogHost />
      <AppLayout
        hubOpen={hubOpen}
        setHubOpen={setHubOpen}
        sidebarTab={sidebarTab}
        setSidebarTab={setSidebarTab}
        projectProps={projectProps}
        chatProps={chatProps}
        storyboardProps={storyboardProps}
        sceneDetailProps={sceneDetailProps}
        entityProps={entityProps}
        projectName={activeProject?.name}
        stats={stats}
        onRestartTutorial={handleRestartTutorial}
        onOpenSettings={onOpenSettings}
        theme={theme}
        onToggleTheme={onToggleTheme}
      />

      {toast ? (
        <div className={`sb-toast sb-toast-${toast.type}`}>
          <span>{toast.message}</span>
          <button onClick={() => setToast(null)} className="sb-toast-close">✕</button>
        </div>
      ) : null}

      {showTutorial ? (
        <TutorialOverlay
          onDone={() => {
            setShowTutorial(false);
            const key = getTutorialStorageKey(authStore.user, authStore.guestMode);
            if (key) localStorage.setItem(key, 'done');
          }}
          onOpenHub={(tab) => {
            setSidebarTab(tab);
            setHubOpen(true);
          }}
        />
      ) : null}
    </>
  );
}

function countScenes(storyboard) {
  const acts = Array.isArray(storyboard?.acts) ? storyboard.acts : [];
  let total = 0;
  for (const act of acts) {
    for (const sequence of act.sequences || []) {
      total += (sequence.scenes || []).length;
    }
  }
  return total;
}


function findAct(storyboard, actNumber) {
  const acts = Array.isArray(storyboard?.acts) ? storyboard.acts : [];
  return acts.find((item) => Number(item?.number) === Number(actNumber)) || null;
}

function normalizeSceneNumbers(storyboard) {
  const acts = Array.isArray(storyboard?.acts) ? storyboard.acts : [];
  const seenSceneIds = new Set();
  for (const act of acts) {
    act.sequences = (act.sequences || []).map((sequence, sequenceIndex) => ({
      ...sequence,
      number: sequenceIndex + 1,
    }));

    for (const sequence of act.sequences) {
      sequence.scenes = (sequence.scenes || []).map((scene, index) => ({
        ...scene,
        id: ensureUniqueSceneId(scene?.id, seenSceneIds),
        sceneNumber: `${act.number}.${sequence.number}.${index + 1}`,
      }));
    }
  }
}

function ensureUniqueSceneId(rawId, seenIds) {
  let nextId = String(rawId || '').trim();
  if (!nextId || seenIds.has(nextId)) {
    nextId = createSceneId();
    while (seenIds.has(nextId)) {
      nextId = createSceneId();
    }
  }
  seenIds.add(nextId);
  return nextId;
}

function ensureEntities(project) {
  if (!project.entities || typeof project.entities !== 'object') {
    project.entities = { characters: [], locations: [] };
  }

  if (!Array.isArray(project.entities.characters)) {
    project.entities.characters = [];
  }
  if (!Array.isArray(project.entities.locations)) {
    project.entities.locations = [];
  }
  return project.entities;
}

function addCharacter(entities, draft) {
  const name = String(draft?.name || '').trim();
  if (!name) {
    return '';
  }

  const normalized = entities.characters.find(
    (character) => String(character?.name || '').toLowerCase() === name.toLowerCase()
  );
  if (normalized) {
    return normalized.id;
  }

  const baseId = slugify(name) || `character_${Date.now()}`;
  const id = makeUniqueId(baseId, entities.characters.map((item) => item.id));
  const description = String(draft?.description || '').trim();

  entities.characters.push({
    id,
    name,
    description,
    visualPromptDescription: description,
    role: String(draft?.role || 'Supporting').trim() || 'Supporting',
    firstAppearance: '',
    color: CHARACTER_COLORS[entities.characters.length % CHARACTER_COLORS.length],
  });

  return id;
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function makeUniqueId(baseId, takenIds) {
  const blocked = new Set((takenIds || []).map((id) => String(id || '')));
  if (!blocked.has(baseId)) {
    return baseId;
  }

  let index = 2;
  while (blocked.has(`${baseId}_${index}`)) {
    index += 1;
  }
  return `${baseId}_${index}`;
}

function createSceneId() {
  return `scene_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function uniqueStrings(values) {
  const set = new Set();
  for (const value of values || []) {
    const clean = String(value || '').trim();
    if (clean) {
      set.add(clean);
    }
  }
  return [...set];
}

function buildSequenceFocusedPrompt({ userMessage, actNumber, sequenceNumber, sequence }) {
  const scenes = Array.isArray(sequence?.scenes) ? sequence.scenes : [];
  const sceneSummary =
    scenes.length > 0
      ? scenes
        .map((scene) => {
          const title = String(scene?.title || '').trim() || scene?.id || 'Untitled';
          const context = String(scene?.storyFunction || scene?.location || scene?.mood || '').trim();
          return `- ${title}${context ? `: ${context}` : ''} (id: ${scene.id})`;
        })
        .join('\n')
      : '- No shots yet in this scene.';

  return [
    `[FOCUS_SCENE] Sequence ${actNumber}, Scene ${sequenceNumber}: ${sequence?.title || 'Untitled Scene'}`,
    'Use this focused context for refinement or additions.',
    'Prefer updating/adding shots inside this scene unless user explicitly asks otherwise.',
    'Do not skip ordering. Add only the next shot for this scene unless the user asks for multiple.',
    `If creating a new scene in this sequence, use updates.sequences_add with act=${actNumber}.`,
    `If renaming this scene, use updates.sequences_update with act=${actNumber} and sequence=${sequenceNumber}.`,
    '',
    'Current scene shots:',
    sceneSummary,
    '',
    `User request: ${userMessage}`,
  ].join('\n');
}

function buildActFocusedPrompt({ userMessage, actNumber, act }) {
  const sequences = Array.isArray(act?.sequences) ? act.sequences : [];
  const sequenceSummary =
    sequences.length > 0
      ? sequences
        .map((sequence) => {
          const title = String(sequence?.title || '').trim() || `Scene ${sequence.number}`;
          const shots = Array.isArray(sequence?.scenes) ? sequence.scenes.length : 0;
          return `- Scene ${sequence.number}: ${title} (${shots} shots)`;
        })
        .join('\n')
      : '- No scenes yet in this sequence.';

  const shotSummary =
    sequences.length > 0
      ? sequences
        .flatMap((sequence) =>
          (Array.isArray(sequence?.scenes) ? sequence.scenes : []).map((scene) => {
            const title = String(scene?.title || '').trim() || scene?.id || 'Untitled';
            const context = String(scene?.storyFunction || scene?.location || scene?.mood || '').trim();
            return `- SC${sequence.number} ${title}${context ? `: ${context}` : ''} (id: ${scene.id})`;
          })
        )
        .slice(0, 30)
        .join('\n')
      : '- No shots yet.';

  return [
    `[FOCUS_SEQUENCE] Sequence ${actNumber}: ${act?.title || 'Untitled Sequence'}`,
    'Use this focused context for refinement or additions.',
    'Prefer updates inside this sequence unless user explicitly asks otherwise.',
    'When adding shots, keep scene order strict and avoid skipping scenes.',
    `If adding a new scene here, use updates.sequences_add with act=${actNumber}.`,
    `If renaming this sequence, use updates.acts_update with act=${actNumber}.`,
    '',
    'Current scenes in this sequence:',
    sequenceSummary,
    '',
    'Current shots in this sequence:',
    shotSummary,
    '',
    `User request: ${userMessage}`,
  ].join('\n');
}

function getTutorialStorageKey(user, guestMode) {
  if (guestMode) return 'storyboarder_tutorial_v1_guest';
  if (user?.uid) return `storyboarder_tutorial_v1_${user.uid}`;
  return null;
}
