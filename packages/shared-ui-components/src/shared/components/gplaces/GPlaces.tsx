import React, { useEffect } from 'react';

import { TextField } from '../text-field/TextField';
import { GPlacesProps } from './services/gplacesInterface';

export const GPlaces = React.forwardRef<any, GPlacesProps>(
    ({ fieldId, fieldType, onPlaceSelection, ...props }: GPlacesProps, ref: any) => {
        // Constants
        let autoComplete: any;
        const options = {
            fields: ['address_components', 'name'],
        };

        // Use Effects
        useEffect(() => {
            if (fieldId) {
                initGPlacesAutocomplete();
            }
        }, [fieldId]);
        useEffect(() => {
            if (autoComplete && fieldType)
                autoComplete.setOptions({
                    types: fieldType,
                });
        }, [fieldType]);

        // Methods
        // This function initializes the Google Places API according to field id passed
        // It will display the Places according to value entered in the field
        const initGPlacesAutocomplete = () => {
            const input = document.getElementById(fieldId) as HTMLInputElement;
            if ((window as any).google) {
                autoComplete = new (window as any).google.maps.places.Autocomplete(input, options);
                autoComplete.addListener('place_changed', async () => {
                    const place = await autoComplete.getPlace();
                    onPlaceSelection(place);
                });
            }
        };

        // HTML
        return <TextField id={fieldId} {...props} ref={ref} />;
    },
);
