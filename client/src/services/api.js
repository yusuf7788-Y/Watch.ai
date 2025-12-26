import axios from 'axios';

const API_URL = 'http://localhost:3001/api';

export const getFiles = async () => {
    const response = await axios.get(`${API_URL}/files`);
    return response.data;
};

export const getFileContent = async (path) => {
    const response = await axios.post(`${API_URL}/file`, { path });
    return response.data.content;
};

export const saveFile = async (path, content) => {
    await axios.post(`${API_URL}/save`, { path, content });
};

export const createFile = async (path, type) => {
    await axios.post(`${API_URL}/file/create`, { path, type });
}

export const deleteFile = async (path) => {
    await axios.delete(`${API_URL}/file`, { data: { path } });
}

export const sendChat = async (message, context) => {
    const response = await axios.post(`${API_URL}/chat`, { message, context });
    return response.data;
};
