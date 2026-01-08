import React, { useState, useCallback } from 'react';
import { ModelDropdown, ModelItem } from '../model-dropdown';
import sampleModels from './sample-model.json';
import './ModelSelector.css';

interface SampleModelData {
  models: ModelItem[];
}

export interface ModelSelectorProps {
  onModelChange?: (model: ModelItem | null) => void;
  className?: string;
  maxHeight?: number;
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({
  onModelChange,
  className = '',
  maxHeight = 400,
}) => {
  const [selectedModel, setSelectedModel] = useState<ModelItem | null>(null);

  // Extract models from the JSON structure
  const models = (sampleModels as SampleModelData).models;

  const handleModelSelect = useCallback(
    (model: ModelItem | null) => {
      setSelectedModel(model);
      onModelChange?.(model);
    },
    [onModelChange]
  );

  return (
    <div className={`model-selector ${className}`}>
      <div className="model-selector__container">
        <label htmlFor="model-dropdown" className="model-selector__label">
          Select 3D Model
        </label>
        <ModelDropdown
          models={models}
          selectedModel={selectedModel}
          onModelSelect={handleModelSelect}
          placeholder="Choose a model from the list..."
          maxHeight={maxHeight}
          className="model-selector__dropdown"
        />
        {selectedModel && (
          <div className="model-selector__info">
            <h3 className="model-selector__info-title">Selected Model</h3>
            <div className="model-selector__info-content">
              <p>
                <strong>Name:</strong> {selectedModel.name}
              </p>
              {selectedModel.pixelSize && (
                <p>
                  <strong>Pixel Size:</strong> {selectedModel.pixelSize}
                </p>
              )}
              {selectedModel.pixelStyle && (
                <p>
                  <strong>Pixel Style:</strong> {selectedModel.pixelStyle}
                </p>
              )}
              {selectedModel.colorOrder && (
                <p>
                  <strong>Color Order:</strong> {selectedModel.colorOrder}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

