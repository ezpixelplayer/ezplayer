import React, { useState, useRef, useCallback, useMemo } from 'react';
import './ModelDropdown.css';

export interface ModelItem {
  name: string;
  pixelSize?: number;
  pixelStyle?: string;
  colorOrder?: string;
  nodes?: any[];
  [key: string]: unknown;
}

export interface ModelDropdownProps {
  models: ModelItem[];
  selectedModel?: ModelItem | null;
  onModelSelect: (model: ModelItem | null) => void;
  placeholder?: string;
  maxHeight?: number;
  className?: string;
  disabled?: boolean;
}

export const ModelDropdown: React.FC<ModelDropdownProps> = ({
  models,
  selectedModel = null,
  onModelSelect,
  placeholder = 'Select a model',
  maxHeight = 300,
  className = '',
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleToggle = useCallback(() => {
    if (!disabled) {
      setIsOpen((prev) => !prev);
    }
  }, [disabled]);

  const handleSelect = useCallback(
    (model: ModelItem) => {
      // Toggle selection: if the clicked model is already selected, deselect it
      if (selectedModel?.name === model.name) {
        onModelSelect(null);
      } else {
        onModelSelect(model);
      }
      setIsOpen(false);
    },
    [onModelSelect, selectedModel]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent, model?: ModelItem) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (model) {
          handleSelect(model);
        } else {
          handleToggle();
        }
      } else if (event.key === 'Escape') {
        setIsOpen(false);
      }
    },
    [handleSelect, handleToggle]
  );

  const displayText = useMemo(() => {
    return selectedModel?.name || placeholder;
  }, [selectedModel, placeholder]);

  return (
    <div
      ref={dropdownRef}
      className={`model-dropdown ${className} ${disabled ? 'model-dropdown--disabled' : ''}`}
    >
      <button
        type="button"
        className={`model-dropdown__trigger ${isOpen ? 'model-dropdown__trigger--open' : ''}`}
        onClick={handleToggle}
        onKeyDown={(e) => handleKeyDown(e)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className="model-dropdown__trigger-text">{displayText}</span>
        <svg
          className={`model-dropdown__arrow ${isOpen ? 'model-dropdown__arrow--open' : ''}`}
          width="12"
          height="8"
          viewBox="0 0 12 8"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M1 1.5L6 6.5L11 1.5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {isOpen && (
        <div
          className="model-dropdown__list-container"
          style={{ maxHeight: `${maxHeight}px` }}
          role="listbox"
        >
          <ul className="model-dropdown__list">
            {models.map((model, index) => {
              const isSelected = selectedModel?.name === model.name;
              return (
                <li
                  key={`${model.name}-${index}`}
                  className={`model-dropdown__item ${isSelected ? 'model-dropdown__item--selected' : ''
                    }`}
                  onClick={() => handleSelect(model)}
                  onKeyDown={(e) => handleKeyDown(e, model)}
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={0}
                >
                  {model.name}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
};

