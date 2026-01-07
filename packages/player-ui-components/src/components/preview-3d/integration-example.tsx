/**
 * Complete integration example showing how to use ModelSelector
 * in a real application with the Preview3D component
 */

import React, { useState } from 'react';
import { ModelSelector } from './ModelSelector';
import { ModelItem } from '../model-dropdown';

/**
 * Example: Integration with a 3D viewer
 */
export const ModelViewerApp: React.FC = () => {
  const [currentModel, setCurrentModel] = useState<ModelItem | null>(null);

  const handleModelChange = (model: ModelItem | null) => {
    setCurrentModel(model);
    
    // Here you would typically:
    // 1. Parse the model data
    // 2. Convert to your internal 3D scene format (Scene3D.types.ts)
    // 3. Pass to your 3D renderer/viewer
    
    if (model) {
      console.log('Loading model:', model.name);
      // Example: loadModelInto3DViewer(model);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* Header with model selector */}
      <header style={{ 
        padding: '20px', 
        backgroundColor: '#ffffff',
        borderBottom: '1px solid #e5e7eb',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
      }}>
        <div style={{ maxWidth: '400px' }}>
          <ModelSelector 
            onModelChange={handleModelChange}
            maxHeight={350}
          />
        </div>
      </header>

      {/* Main 3D viewer area */}
      <main style={{ 
        flex: 1, 
        backgroundColor: '#1a1a1a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#ffffff'
      }}>
        {currentModel ? (
          <div style={{ textAlign: 'center' }}>
            <h2 style={{ fontSize: '24px', marginBottom: '16px' }}>
              {currentModel.name}
            </h2>
            <p style={{ color: '#a0a0a0' }}>
              3D viewer will render here
            </p>
            {/* Your Preview3D or Viewer3D component would go here */}
            {/* <Preview3D model={currentModel} /> */}
          </div>
        ) : (
          <div style={{ textAlign: 'center', color: '#a0a0a0' }}>
            <p style={{ fontSize: '18px' }}>
              Select a model from the dropdown above
            </p>
          </div>
        )}
      </main>
    </div>
  );
};

/**
 * Example: Side-by-side layout
 */
export const SideBySideLayout: React.FC = () => {
  const [selectedModel, setSelectedModel] = useState<ModelItem | null>(null);

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      {/* Left sidebar with controls */}
      <aside style={{ 
        width: '350px',
        padding: '24px',
        backgroundColor: '#f9fafb',
        borderRight: '1px solid #e5e7eb',
        overflowY: 'auto'
      }}>
        <h1 style={{ fontSize: '24px', marginBottom: '24px', color: '#111827' }}>
          Model Library
        </h1>
        
        <ModelSelector 
          onModelChange={setSelectedModel}
          maxHeight={500}
        />

        {selectedModel && (
          <div style={{ marginTop: '24px' }}>
            <button style={{
              width: '100%',
              padding: '12px',
              backgroundColor: '#4a90e2',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer'
            }}>
              Load into Scene
            </button>
          </div>
        )}
      </aside>

      {/* Right side 3D viewer */}
      <main style={{ flex: 1, backgroundColor: '#1a1a1a' }}>
        {/* Your 3D viewer component */}
      </main>
    </div>
  );
};

/**
 * Example: Programmatic model conversion
 * Shows how to convert sample-model.json format to Scene3D format
 */
export const convertModelToScene3D = (model: ModelItem) => {
  // Extract coordinates from the model's nodes
  const points: number[] = [];
  
  if (model.nodes && Array.isArray(model.nodes)) {
    model.nodes.forEach((node: any) => {
      if (node.coords && Array.isArray(node.coords)) {
        node.coords.forEach((coord: any) => {
          // Extract world coordinates (wX, wY, wZ)
          points.push(coord.wX || 0);
          points.push(coord.wY || 0);
          points.push(coord.wZ || 0);
        });
      }
    });
  }

  // Convert to Scene3D format (from Scene3D.types.ts)
  return {
    models: [
      {
        id: `model-${model.name}`,
        name: model.name as string,
        modelType: 'points' as const,
        pointCount: points.length / 3,
        points: new Float32Array(points),
        pixelStyle: 'circle' as const,
        pixelSize: typeof model.pixelSize === 'number' ? model.pixelSize : 1,
      },
    ],
  };
};

export default ModelViewerApp;

