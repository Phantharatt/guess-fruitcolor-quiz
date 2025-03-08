import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();
// const pixabay_api = process.env.PIXABAY_API_KEY;
const pixabay_api = process.env.PIXABAY_API;
const pixabay_api_url = 'https://pixabay.com/api/';

export async function getFruitImages(fruit,color) {
    try {
        const response = await axios.get(pixabay_api_url, {
            params: {
                key: pixabay_api,
                q: 'fruit ' + fruit + ' ' +color,
                per_page: 3
            }
        });
        // console.log(response.data.hits[0]);
        return response.data.hits[0];
    } catch (err) {
        console.error('Can not get data from Pixabay API:', err);
        return [];
    }
}