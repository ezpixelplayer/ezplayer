export const saveFile = async (fn: string, content: string) => {
    try {
        const filePath = await window.electronAPI.writeFile(fn, content);
        console.log('File written successfully: ', filePath);
    } catch (error) {
        console.error('Error saving file:', error);
        throw error;
    }
};

export const loadFile = async (fpath: string) => {
    try {
        const content = await window.electronAPI.readFile(fpath);
        console.log('File read successfully:', fpath);
        return content;
    } catch (error) {
        console.error('Error saving file:', error);
        throw error;
    }
};
