import { useEffect, useId, useState } from 'react';
import { useMediaQuery } from '../lib/useMediaQuery';
import { Button } from './Button';
import { IconAlert, IconCamera, IconImage } from './icons';
import { PhotoSlot } from './PhotoSlot';

interface PhotoInputProps {
  legend?: string;
  file: File | null;
  /** Photo already stored, shown when no new file is chosen. */
  currentPath?: string | null;
  onChange(file: File | null): void;
  error?: string | null;
  /** 0–1 while uploading, null otherwise. */
  progress: number | null;
}

/** "Choisir une photo", and "Prendre une photo" on touch devices; preview, progress and error. */
export function PhotoInput({ legend = 'Photo', file, currentPath, onChange, error, progress }: PhotoInputProps) {
  const id = useId();
  const touch = useMediaQuery('(pointer: coarse)');
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <fieldset className="photo-input" aria-describedby={error ? `${id}-error` : undefined}>
      <legend>
        {legend} <span className="field__optional">(facultatif)</span>
      </legend>
      <div className="photo-input__row">
        <PhotoSlot size={72} preview={preview} path={file ? null : currentPath} alt={file ? 'Aperçu de la photo choisie' : ''} />
        <div className="photo-input__actions">
          <label className="btn btn--secondary btn--small photo-input__pick">
            <input
              type="file"
              accept="image/*"
              className="visually-hidden"
              onChange={(e) => {
                onChange(e.target.files?.[0] ?? null);
                e.target.value = '';
              }}
            />
            <IconImage size={16} aria-hidden="true" />
            Choisir une photo
          </label>
          {touch && (
            <label className="btn btn--secondary btn--small photo-input__pick">
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="visually-hidden"
                onChange={(e) => {
                  onChange(e.target.files?.[0] ?? null);
                  e.target.value = '';
                }}
              />
              <IconCamera size={16} aria-hidden="true" />
              Prendre une photo
            </label>
          )}
          {file && (
            <Button variant="ghost" size="small" onClick={() => onChange(null)}>
              Retirer la photo
            </Button>
          )}
        </div>
      </div>
      {progress != null && (
        <div
          className="progress"
          role="progressbar"
          aria-label="Envoi de la photo"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
        >
          <span className="progress__bar" style={{ width: `${Math.max(6, progress * 100)}%` }} />
        </div>
      )}
      {error && (
        <p className="field__error" id={`${id}-error`} role="alert">
          <IconAlert size={14} aria-hidden="true" style={{ flex: 'none', marginTop: 2 }} />
          {error}
        </p>
      )}
    </fieldset>
  );
}
