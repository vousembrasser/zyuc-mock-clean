'use client';
import SshConfigForm from "@/components/SshConfigForm";
import Layout from "@/components/Layout";
import React, { Suspense } from 'react';

const FormLoading = () => {
    return <div>正在加载配置表单...</div>;
}

export default function EditSshConfigPage() {
    return (
        <Layout title="">
            <Suspense fallback={<FormLoading />}>
                <SshConfigForm />
            </Suspense>
        </Layout>
    );
}