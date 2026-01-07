/**
 * Demo component showing how to use ModelSelector
 * This can be imported and used in your application
 */

import React from 'react';
import { ModelSelector } from './ModelSelector';
import { ModelItem } from '../model-dropdown';

export const ModelSelectorDemo: React.FC = () => {
  const handleModelChange = (model: ModelItem | null) => {
    console.log('Selected model:', model);
    // Here you can add logic to:
    // - Load the 3D model
    // - Update the scene
    // - Pass data to other components
  };

  return (
    <div style={{ padding: '40px', minHeight: '100vh', backgroundColor: '#f3f4f6' }}>
      <div style={{ maxWidth: '800px', margin: '0 auto' }}>
        <h1 style={{ 
          fontSize: '32px', 
          fontWeight: 'bold', 
          marginBottom: '32px',
          color: '#111827',
          textAlign: 'center'
        }}>
          3D Model Selector
        </h1>
        
        <ModelSelector 
          onModelChange={handleModelChange}
          maxHeight={400}
        />

        <div style={{
          marginTop: '32px',
          padding: '20px',
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          border: '1px solid #e5e7eb'
        }}>
          <h2 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '16px', color: '#111827' }}>
            Features
          </h2>
          <ul style={{ paddingLeft: '20px', color: '#4b5563', lineHeight: '1.8' }}>
            <li>✨ Scrollable dropdown for 55+ models</li>
            <li>🎨 Modern, accessible UI design</li>
            <li>⌨️ Keyboard navigation support (Enter, Space, Escape)</li>
            <li>🖱️ Click outside to close</li>
            <li>📱 Responsive design for mobile devices</li>
            <li>🎯 Visual feedback for selected model</li>
            <li>♿ ARIA attributes for accessibility</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default ModelSelectorDemo;

