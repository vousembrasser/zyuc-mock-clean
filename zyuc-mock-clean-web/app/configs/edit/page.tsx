'use client';
import ConfigForm from "@/components/ConfigForm";
import Layout from "@/components/Layout";
import React, { Suspense } from 'react'; // 1. Import Suspense

// A simple loading component to show while the form is loading
const FormLoading = () => {
    return <div>正在加载配置表单...</div>;
}

export default function EditConfigPage() {
    return (
        <Layout title="">
            {/* 2. Wrap the component that uses useSearchParams in a Suspense boundary */}
            <Suspense fallback={<FormLoading />}>
                <ConfigForm />
            </Suspense>
        </Layout>
    );
}