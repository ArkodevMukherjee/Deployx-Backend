import http from 'k6/http';
import { check } from 'k6';

// Put a dedicated test user's JWT here.
const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY5Zjc3YzZkMTdkYWMyZmJmZDAwOWQxYSIsInByb3ZpZGVyIjoibG9jYWwiLCJpYXQiOjE3ODYzMzc2MjQsImV4cCI6MTc4NjM0MTIyNH0.pToq1jO1Tpvqm9Qze6xHFsEps6YBEabfGy4_Kumhwv4';

export const options = {
    vus: 50,
    duration: '400s',

    thresholds: {
        http_req_failed: ['rate<0.01'],
        http_req_duration: ['p(95)<1000'],
    },
};

export default function () {

    const payload = JSON.stringify({
        isUrlDeployment: true,

        // Use a harmless public URL.
        // The URL deployment worker should NOT consume the test queue.
        url: 'https://example.com',

        environment: 'production',
        projectType: 'react',
    });

    const params = {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${TOKEN}`,
        },

        tags: {
            name: 'POST /deploy',
        },
    };

    const response = http.post(
        'https://backend.neurastack.xyz/deploy',
        payload,
        params
    );

    check(response, {
        'status is 202': (r) => r.status === 202,
        'deploymentId exists': (r) => {
            try {
                return !!r.json('deploymentId');
            } catch {
                return false;
            }
        },
        'deployedUrl exists': (r) => {
            try {
                return !!r.json('deployedUrl');
            } catch {
                return false;
            }
        },
    });
}